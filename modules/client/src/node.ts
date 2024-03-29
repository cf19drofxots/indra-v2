import { IMessagingService } from "@connext/messaging";
import {
  AppRegistry,
  CreateChannelResponse,
  GetChannelResponse,
  GetConfigResponse,
  SupportedApplication,
  SupportedNetwork,
} from "@connext/types";
import { Address, Node as NodeTypes } from "@counterfactual/types";
import { Subscription } from "ts-nats";
import uuid = require("uuid");

import { Logger } from "./lib/logger";
import { NodeInitializationParameters } from "./types";
import { Wallet } from "./wallet";

// TODO: move to types.ts?
const API_TIMEOUT = 5000;

export interface INodeApiClient {
  config(): Promise<GetConfigResponse>;
  appRegistry(appDetails?: {
    name: SupportedApplication;
    network: SupportedNetwork;
  }): Promise<AppRegistry>;
  authenticate(): void; // TODO: implement!
  getChannel(): Promise<GetChannelResponse>;
  createChannel(): Promise<CreateChannelResponse>;
  subscribeToSwapRates(from: string, to: string, store: NodeTypes.IStoreService): Promise<void>;
  unsubscribeFromSwapRates(from: string, to: string): Promise<void>;
  requestCollateral(): Promise<void>;
}

export type SwapSubscription = {
  from: string;
  to: string;
  subscription: Subscription;
};

export class NodeApiClient implements INodeApiClient {
  public messaging: IMessagingService;
  public wallet: Wallet;
  public address: Address;
  public log: Logger;
  public nonce: string | undefined;
  public signature: string | undefined;
  public userPublicIdentifier: string | undefined;
  public nodePublicIdentifier: string | undefined;

  // subscription references
  public exchangeSubscriptions: SwapSubscription[] | undefined;

  constructor(opts: NodeInitializationParameters) {
    this.messaging = opts.messaging;
    this.wallet = opts.wallet;
    this.address = opts.wallet.address;
    this.log = new Logger("NodeApiClient", opts.logLevel);
    this.userPublicIdentifier = opts.userPublicIdentifier;
    this.nodePublicIdentifier = opts.nodePublicIdentifier;
  }

  ///////////////////////////////////
  //////////// PUBLIC //////////////
  /////////////////////////////////

  public setUserPublicIdentifier(publicIdentifier: string): void {
    this.userPublicIdentifier = publicIdentifier;
  }

  public setNodePublicIdentifier(publicIdentifier: string): void {
    this.nodePublicIdentifier = publicIdentifier;
  }

  ///// Endpoints
  public async config(): Promise<GetConfigResponse> {
    // get the config from the hub
    try {
      const configRes = await this.send("config.get");
      // handle error here
      return configRes as GetConfigResponse;
    } catch (e) {
      return Promise.reject(e);
    }
  }

  public async appRegistry(appDetails?: {
    name: SupportedApplication;
    network: SupportedNetwork;
  }): Promise<AppRegistry> {
    try {
      const registryRes = await this.send("app-registry", appDetails);
      return registryRes as AppRegistry;
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // TODO: NATS authentication procedure?
  // Use TLS based auth, eventually tied to HNS
  // names, for 2.0-2.x will need to generate our
  // own certs linked to their public key
  public authenticate(): void {}

  public async getChannel(): Promise<GetChannelResponse> {
    try {
      const channelRes = await this.send(`channel.get.${this.userPublicIdentifier}`);
      // handle error here
      return channelRes;
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // TODO: can we abstract this try-catch thing into a separate function?
  public async createChannel(): Promise<CreateChannelResponse> {
    try {
      const channelRes = await this.send(`channel.create.${this.userPublicIdentifier}`);
      // handle error here
      return channelRes;
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // TODO: types for exchange rates and store?
  // TODO: is this the best way to set the store for diff types
  // of tokens
  public async subscribeToSwapRates(
    from: string,
    to: string,
    store: NodeTypes.IStoreService,
  ): Promise<void> {
    const subscription = await this.messaging.subscribe(
      `exchange-rate.${from}.${to}`,
      (err: any, msg: any) => {
        if (err) {
          this.log.error(JSON.stringify(err, null, 2));
        } else {
          store.set([
            {
              key: `${msg.pattern}-${Date.now().toString()}`,
              value: msg.data,
            },
          ]);
          return msg.data;
        }
      },
    );
    this.exchangeSubscriptions.push({
      from,
      subscription,
      to,
    });
  }

  public async unsubscribeFromSwapRates(from: string, to: string): Promise<void> {
    if (!this.exchangeSubscriptions || this.exchangeSubscriptions.length === 0) {
      return;
    }

    const matchedSubs = this.exchangeSubscriptions.filter((sub: SwapSubscription) => {
      return sub.from === from && sub.to === to;
    });

    if (matchedSubs.length === 0) {
      this.log.warn(`Could not find subscription for ${from}:${to} pair`);
      return;
    }

    matchedSubs.forEach((sub: SwapSubscription) => sub.subscription.unsubscribe());
  }

  // FIXME: right now node doesnt return until the deposit has completed
  // which exceeds the timeout.....
  public async requestCollateral(): Promise<void> {
    try {
      const channelRes = await this.send(`channel.request-collateral.${this.userPublicIdentifier}`);
      return channelRes;
    } catch (e) {
      // FIXME: node should return once deposit starts
      if (e.message.startsWith("Request timed out")) {
        this.log.info(`request collateral message timed out`);
        return;
      }
      return Promise.reject(e);
    }
  }

  ///////////////////////////////////
  //////////// PRIVATE /////////////
  /////////////////////////////////
  private async send(subject: string, data?: any): Promise<any | undefined> {
    this.log.info(
      `Sending request to ${subject} ${
        data ? `with data: ${JSON.stringify(data, null, 2)}` : `without data`
      }`,
    );
    const msg = await this.messaging.request(subject, API_TIMEOUT, {
      data,
      id: uuid.v4(),
    });
    if (!msg.data) {
      console.log("could this message be malformed?", JSON.stringify(msg, null, 2));
      return undefined;
    }
    const { err, response, ...rest } = msg.data;
    if (err) {
      throw new Error(`Error sending request. Message: ${JSON.stringify(msg, null, 2)}`);
    }
    return !response || Object.keys(response).length === 0 ? undefined : response;
  }
}
