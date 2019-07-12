import { IMessagingService } from "@connext/messaging";
import { AppState, ChannelProvider, ChannelState, MultisigState } from "@connext/types";
import { Node } from "@counterfactual/node";
import { NetworkContext } from "@counterfactual/types";
import { utils } from "ethers";
import { Client as NatsClient } from "ts-nats";

import { ConnextListener } from "./listener";
import { NodeApiClient } from "./node";
import { Wallet } from "./wallet";
import { any } from "prop-types";
import { Web3Provider } from "ethers/providers";

export type BigNumber = utils.BigNumber;
export const BigNumber = utils.BigNumber;

export interface ClientOptions {
  // provider, passed through to CF node
  rpcProviderUrl?: string; // TODO: can we keep out web3

  // node information
  nodeUrl: string; // ws:// or nats:// urls are supported

  // signing options, include at least one of the following
  mnemonic?: string;
  // if using an external wallet, include this option
  externalWallet?: any; // TODO: better typing here?
  // FIXME: remove ^^?

  // channel provider
  channelProvider?: ChannelProvider;
  web3Provider?: Web3Provider;

  // function passed in by wallets to generate ephemeral keys
  // used when signing applications
  keyGen?: () => Promise<string>; // TODO: what will the type look like?
  safeSignHook?: (state: ChannelState | AppState) => Promise<string>;
  // TODO: Do we need these if we use the whole store?
  loadState?: (key: string) => Promise<string | null>;
  saveState?: (
    pairs: {
      key: string;
      value: any;
    }[],
  ) => Promise<void>;
  store: any;
  // TODO: state: string?
  logLevel?: number; // see logger.ts for meaning, optional

  // TODO: should be used in internal options? --> only if hardcoded
  // nats communication config, client must provide
  natsClusterId?: string;
  natsToken?: string;
}

export type InternalClientOptions = ClientOptions & {
  // TODO: can nats, node, wallet be optional?
  nats: NatsClient; // converted to nats-client in ConnextInternal constructor
  node: NodeApiClient;
  listener: ConnextListener;
  // signing wallet/information
  wallet: Wallet;
  // store: ConnextStore; --> whats this look like
  contract?: MultisigState;
  // counterfactual node
  cfModule?: Node;
  channelProvider?: any;
  multisigAddress: string;
  nodePublicIdentifier: string;
  network: utils.Network; // TODO: delete! use bos branch!
};

// TODO: define properly!!
export interface ConnextStore {}

///////////////////////////////////
////////// NODE TYPES ////////////
/////////////////////////////////

////// General typings
export interface NodeInitializationParameters {
  messaging: IMessagingService;
  wallet: Wallet;
  logLevel?: number;
  publicIdentifier?: string;
}
