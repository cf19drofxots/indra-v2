import { MessagingServiceFactory } from "@connext/messaging";
import {
  AppRegistry,
  ChannelState,
  DepositParameters,
  ExchangeParameters,
  GetConfigResponse,
  NodeChannel,
  SupportedApplication,
  TransferAction,
  TransferParameters,
  WithdrawParameters,
} from "@connext/types";
import { jsonRpcDeserialize, MNEMONIC_PATH, Node } from "@counterfactual/node";
import { Address, AppInstanceInfo, Node as NodeTypes, OutcomeType } from "@counterfactual/types";
import "core-js/stable";
import { Zero } from "ethers/constants";
import { BigNumber, Network } from "ethers/utils";
import { fromExtendedKey } from "ethers/utils/hdnode";
import "regenerator-runtime/runtime";
import { Client as NatsClient, Payload } from "ts-nats";

import { DepositController } from "./controllers/DepositController";
import { ExchangeController } from "./controllers/ExchangeController";
import { TransferController } from "./controllers/TransferController";
import { WithdrawalController } from "./controllers/WithdrawalController";
import { Logger } from "./lib/logger";
import { logEthFreeBalance, publicIdentifierToAddress } from "./lib/utils";
import { ConnextListener } from "./listener";
import { NodeApiClient } from "./node";
import { ClientOptions, InternalClientOptions } from "./types";
import { invalidAddress } from "./validation/addresses";
import { falsy, notLessThanOrEqualTo, notPositive } from "./validation/bn";
import { Wallet } from "./wallet";

/**
 * Creates a new client-node connection with node at specified url
 *
 * @param opts The options to instantiate the client with.
 * At a minimum, must contain the nodeUrl and a client signing key or mnemonic
 */

export async function connect(opts: ClientOptions): Promise<ConnextInternal> {
  // create a new wallet
  const wallet = new Wallet(opts);
  const network = await wallet.provider.getNetwork();

  console.log("Creating messaging service client");
  const { natsClusterId, nodeUrl, natsToken } = opts;
  const messagingFactory = new MessagingServiceFactory({
    clusterId: natsClusterId,
    messagingUrl: nodeUrl,
    token: natsToken,
  });
  const messaging = messagingFactory.createService("messaging");
  await messaging.connect();
  console.log("Messaging service is connected");

  // TODO: we need to pass in the whole store to retain context. Figure out how to do this better
  // Note: added this to the client since this is required for the cf module to work
  await opts.store.set([{ key: MNEMONIC_PATH, value: opts.mnemonic }]);

  // create a new node api instance
  // TODO: use local storage for default key value setting!!
  const nodeConfig = {
    logLevel: opts.logLevel,
    messaging,
    wallet,
  };
  console.log("creating node client");
  const node: NodeApiClient = new NodeApiClient(nodeConfig);
  console.log("created node client successfully");

  const config = await node.config();
  console.log(`node eth network: ${JSON.stringify(config.ethNetwork)}`);

  let cfModule, channelProvider;

  if(opts.mnemonic) {
    // create new cfModule to inject into internal instance
    console.log("creating new cf module");
    cfModule = await Node.create(
      messaging,
      opts.store,
      {
        STORE_KEY_PREFIX: "store",
      }, // TODO: proper config
      wallet.provider,
      config.contractAddresses,
    );
  } else if (opts.channelProvider){
    // else use provider
    channelProvider = opts.channelProvider;
  } else {
    throw new Error("You must pass in either a mnemonic or channel provider")
  }
  node.setPublicIdentifier(cfModule.publicIdentifier);
  console.log("created cf module successfully");

  console.log("creating listener");
  const listener: ConnextListener = new ConnextListener(cfModule, opts.logLevel);
  console.log("created listener");

  // TODO: make these types
  let myChannel = await node.getChannel();

  if (!myChannel) {
    // TODO: make these types
    console.log("no channel detected, creating channel..");
    myChannel = await node.createChannel();
  }
  console.log("myChannel: ", myChannel);
  // create the new client
  return new ConnextInternal({
    cfModule,
    channelProvider,
    listener,
    multisigAddress: myChannel.multisigAddress,
    nats: messaging.getConnection(),
    network,
    node,
    nodePublicIdentifier: config.nodePublicIdentifier,
    wallet,
    ...opts, // use any provided opts by default
  });
}

/**
 * This abstract class contains all methods associated with managing
 * or establishing the user's channel.
 *
 * The true implementation of this class exists in the `ConnextInternal`
 * class
 */
export abstract class ConnextChannel {
  public opts: InternalClientOptions;
  private internal: ConnextInternal;

  public constructor(opts: InternalClientOptions) {
    this.opts = opts;
    this.internal = this as any;
  }

  ///////////////////////////////////
  // LISTENER METHODS
  public on = (event: NodeTypes.EventName, callback: (...args: any[]) => void): ConnextListener => {
    return this.internal.on(event, callback);
  };

  public emit = (event: NodeTypes.EventName, data: any): boolean => {
    return this.internal.emit(event, data);
  };

  ///////////////////////////////////
  // CORE CHANNEL METHODS

  // TODO: do we want the inputs to be an object?
  public deposit = async (params: DepositParameters): Promise<ChannelState> => {
    return await this.internal.deposit(params);
  };

  public exchange = async (params: ExchangeParameters): Promise<ChannelState> => {
    return await this.internal.exchange(params);
  };

  public transfer = async (params: TransferParameters): Promise<NodeChannel> => {
    return await this.internal.transfer(params);
  };

  public withdraw = async (params: WithdrawParameters): Promise<ChannelState> => {
    return await this.internal.withdraw(params);
  };

  ///////////////////////////////////
  // NODE EASY ACCESS METHODS
  public config = async (): Promise<GetConfigResponse> => {
    return await this.internal.config();
  };

  public getChannel = async (): Promise<NodeChannel> => {
    return await this.internal.node.getChannel();
  };

  ///////////////////////////////////
  // CF MODULE EASY ACCESS METHODS
  public getFreeBalance = async (): Promise<NodeTypes.GetFreeBalanceStateResult> => {
    return await this.internal.getFreeBalance();
  };

  // TODO: remove this when not testing (maybe?)
  // FIXME: remove
  public logEthFreeBalance = (
    freeBalance: NodeTypes.GetFreeBalanceStateResult,
    log?: Logger,
  ): void => {
    logEthFreeBalance(freeBalance, log);
  };

  public getAppInstances = async (): Promise<AppInstanceInfo[]> => {
    return await this.internal.getAppInstances();
  };

  public getAppInstanceDetails = async (
    appInstanceId: string,
  ): Promise<NodeTypes.GetAppInstanceDetailsResult> => {
    return await this.internal.getAppInstanceDetails(appInstanceId);
  };

  public getAppState = async (appInstanceId: string): Promise<NodeTypes.GetStateResult> => {
    return await this.internal.getAppState(appInstanceId);
  };

  public installTransferApp = async (
    counterpartyPublicIdentifier: string,
    initialDeposit: BigNumber,
  ): Promise<NodeTypes.ProposeInstallVirtualResult> => {
    return await this.internal.installTransferApp(counterpartyPublicIdentifier, initialDeposit);
  };

  public uninstallVirtualApp = async (
    appInstanceId: string,
  ): Promise<NodeTypes.UninstallVirtualResult> => {
    return await this.internal.uninstallVirtualApp(appInstanceId);
  };
}

/**
 * True implementation of the connext client
 */
export class ConnextInternal extends ConnextChannel {
  public opts: InternalClientOptions;
  public cfModule: Node;
  public channelProvider: any;
  public publicIdentifier: string;
  public wallet: Wallet;
  public node: NodeApiClient;
  public nats: NatsClient;
  public multisigAddress: Address;
  public listener: ConnextListener;
  public myFreeBalanceAddress: Address;
  public nodePublicIdentifier: string;
  public freeBalanceAddress: string;
  // TODO: maybe move this into the NodeApiClient @layne? --> yes

  public logger: Logger;
  public network: Network;

  ////////////////////////////////////////
  // Setup channel controllers
  private depositController: DepositController;
  private transferController: TransferController;
  private exchangeController: ExchangeController;
  private withdrawalController: WithdrawalController;

  constructor(opts: InternalClientOptions) {
    super(opts);

    this.opts = opts;

    this.wallet = opts.wallet;
    this.node = opts.node;
    this.nats = opts.nats;

    this.cfModule = opts.cfModule;
    this.freeBalanceAddress = this.cfModule.ethFreeBalanceAddress;
    this.publicIdentifier = this.cfModule.publicIdentifier;
    this.multisigAddress = this.opts.multisigAddress;
    this.nodePublicIdentifier = this.opts.nodePublicIdentifier;

    this.logger = new Logger("ConnextInternal", opts.logLevel);
    // TODO: fix with bos config!
    this.network = opts.network;

    // establish listeners
    this.listener = opts.listener;
    this.connectDefaultListeners();

    // instantiate controllers with logger and cf
    this.depositController = new DepositController("DepositController", this);
    this.transferController = new TransferController("TransferController", this);
    this.exchangeController = new ExchangeController("ExchangeController", this);
    this.withdrawalController = new WithdrawalController("WithdrawalController", this);
  }

  ///////////////////////////////////
  // CORE CHANNEL METHODS

  public deposit = async (params: DepositParameters): Promise<ChannelState> => {
    return await this.depositController.deposit(params);
  };

  public exchange = async (params: ExchangeParameters): Promise<ChannelState> => {
    return await this.exchangeController.exchange(params);
  };

  public transfer = async (params: TransferParameters): Promise<NodeChannel> => {
    return await this.transferController.transfer(params);
  };

  public withdraw = async (params: WithdrawParameters): Promise<ChannelState> => {
    return await this.withdrawalController.withdraw(params);
  };

  ///////////////////////////////////
  // NODE METHODS

  public config = async (): Promise<GetConfigResponse> => {
    return await this.node.config();
  };

  ///////////////////////////////////
  // EVENT METHODS

  public on = (event: NodeTypes.EventName, callback: (...args: any[]) => void): ConnextListener => {
    return this.listener.on(event, callback);
  };

  public emit = (event: NodeTypes.EventName, data: any): boolean => {
    return this.listener.emit(event, data);
  };

  ///////////////////////////////////
  // CF MODULE METHODS

  // FIXME: add normal installation methods
  // and other wrappers for all cf node methods

  // TODO: erc20 support?
  public cfDeposit = async (
    amount: BigNumber,
    notifyCounterparty: boolean = true,
  ): Promise<NodeTypes.DepositResult> => {
    const depositAddr = publicIdentifierToAddress(this.cfModule.publicIdentifier);
    const bal = await this.wallet.provider.getBalance(depositAddr);
    const err = [
      notPositive(amount),
      notLessThanOrEqualTo(amount, bal), // cant deposit more than default addr owns
    ].filter(falsy)[0];
    if (err) {
      this.logger.error(err);
      throw new Error(err);
    }
    let depositResponse;

    if(this.channelProvider){
      depositResponse = await this.channelProvider(amount, notifyCounterparty)
    } else {
      depositResponse = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.DEPOSIT,
          params: {
            amount,
            multisigAddress: this.opts.multisigAddress,
            notifyCounterparty,
          },
        }),
      );
    }
    // @ts-ignore --> WHYY?
    return depositResponse as NodeTypes.DepositResult;
  };

  // TODO: under what conditions will this fail?
  public getAppInstances = async (): Promise<AppInstanceInfo[]> => {
    let appInstanceResponse;

    if(this.channelProvider){
      appInstanceResponse = await this.channelProvider.getAppInstances();
    } else {
      appInstanceResponse = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.GET_APP_INSTANCES,
          params: {} as NodeTypes.GetAppInstancesParams,
        }),
      );
    }
    return appInstanceResponse.result.appInstances as AppInstanceInfo[];
  };

  // TODO: under what conditions will this fail?
  public getFreeBalance = async (): Promise<NodeTypes.GetFreeBalanceStateResult> => {
    let freeBalance;

    if (this.channelProvider) {
      freeBalance = await this.channelProvider.getFreeBalance();
    } else {
      freeBalance = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.GET_FREE_BALANCE_STATE,
          params: { multisigAddress: this.multisigAddress },
        }),
      );
    }

    return freeBalance.result as NodeTypes.GetFreeBalanceStateResult;
  };

  public getAppInstanceDetails = async (
    appInstanceId: string,
  ): Promise<NodeTypes.GetAppInstanceDetailsResult | undefined> => {
    const err = await this.appNotInstalled(appInstanceId);
    if (err) {
      this.logger.warn(err);
      return undefined;
    }
    let appInstanceResponse;
    
    if (this.channelProvider) {
      appInstanceResponse = await this.channelProvider.getAppInstanceDetails();
    } else {
       appInstanceResponse = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.GET_APP_INSTANCE_DETAILS,
          params: {
            appInstanceId,
          } as NodeTypes.GetAppInstanceDetailsParams,
        }),
      );
    }

    return appInstanceResponse.result as NodeTypes.GetAppInstanceDetailsResult;
  };

  public getAppState = async (
    appInstanceId: string,
  ): Promise<NodeTypes.GetStateResult | undefined> => {
    // check the app is actually installed, or returned undefined
    const err = await this.appNotInstalled(appInstanceId);
    if (err) {
      this.logger.warn(err);
      return undefined;
    }
    let stateResponse;

    if(this.channelProvider) {
      stateResponse = await this.channelProvider.getAppState();
    } else {
      stateResponse = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.GET_STATE,
          params: {
            appInstanceId,
          } as NodeTypes.GetStateParams,
        }),
      );
    }

    return stateResponse.result as NodeTypes.GetStateResult;
  };

  public takeAction = async (
    appInstanceId: string,
    action: TransferAction,
  ): Promise<NodeTypes.TakeActionResult> => {
    // check the app is actually installed
    const err = await this.appNotInstalled(appInstanceId);
    if (err) {
      this.logger.error(err);
      throw new Error(err);
    }
    // check state is not finalized
    const state: NodeTypes.GetStateResult = await this.getAppState(appInstanceId);
    // FIXME: casting?
    if ((state.state as any).finalized) {
      throw new Error("Cannot take action on an app with a finalized state.");
    }
    let actionResponse;

    if(this.channelProvider) {
      actionResponse = await this.channelProvider.takeAction(appInstanceId, action);
    } else {
      actionResponse = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.TAKE_ACTION,
          params: {
            action,
            appInstanceId,
          } as NodeTypes.TakeActionParams,
        }),
      );
    }

    return actionResponse.result as NodeTypes.TakeActionResult;
  };

  // TODO: add validation after arjuns refactor merged
  public proposeInstallVirtualApp = async (
    appName: SupportedApplication,
    initialDeposit: BigNumber,
    counterpartyPublicIdentifier: string,
  ): Promise<NodeTypes.ProposeInstallVirtualResult> => {
    const { initialStateFinalized, ...paramInfo } = AppRegistry[this.network.name][appName];
    if (!paramInfo) {
      throw new Error("App not found in registry for provided network");
    }
    const params: NodeTypes.ProposeInstallVirtualParams = {
      ...paramInfo,
      // TODO: best way to pass in an initial state?
      initialState: {
        finalized: initialStateFinalized,
        transfers: [
          {
            amount: initialDeposit,
            to: this.wallet.address,
            // TODO: replace? fromExtendedKey(this.publicIdentifier).derivePath("0").address
          },
          {
            amount: Zero,
            to: fromExtendedKey(counterpartyPublicIdentifier).derivePath("0").address,
          },
        ],
      },
      intermediaries: [this.nodePublicIdentifier],
      myDeposit: initialDeposit,
      proposedToIdentifier: counterpartyPublicIdentifier,
    };

    let actionResponse;

    if(this.channelProvider) {
      actionResponse = await this.channelProvider.proposeInstallVirtualApp(appName, initialDeposit, counterpartyPublicIdentifier);
    } else {
      actionResponse = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.PROPOSE_INSTALL_VIRTUAL,
          params,
        }),
      );
    }

    return actionResponse.result as NodeTypes.ProposeInstallVirtualResult;
  };

  public installVirtualApp = async (
    appInstanceId: string,
  ): Promise<NodeTypes.InstallVirtualResult> => {
    // FIXME: make this helper?
    // check the app isnt actually installed
    const apps = await this.getAppInstances();
    const app = apps.filter((app: AppInstanceInfo) => app.identityHash === appInstanceId);
    if (app.length !== 0) {
      throw new Error(
        `Found already installed app with id: ${appInstanceId}. ` +
          `Installed apps: ${JSON.stringify(apps, null, 2)}`,
      );
    }
    let installVirtualResponse;

    if (this.channelProvider) {
      installVirtualResponse = await this.channelProvider.installVirtualApp(appInstanceId);
    } else {
      installVirtualResponse = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.INSTALL_VIRTUAL,
          params: {
            appInstanceId,
            intermediaries: [this.nodePublicIdentifier],
          } as NodeTypes.InstallVirtualParams,
        }),
      );
    }

    return installVirtualResponse.result;
  };

  public uninstallVirtualApp = async (
    appInstanceId: string,
  ): Promise<NodeTypes.UninstallVirtualResult> => {
    // check the app is actually installed
    const err = await this.appNotInstalled(appInstanceId);
    if (err) {
      this.logger.error(err);
      throw new Error(err);
    }
    let uninstallResponse;

    if(this.channelProvider) {
      uninstallResponse = await this.channelProvider.uninstallVirtualApp(appInstanceId);
    } else {
      uninstallResponse = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.UNINSTALL_VIRTUAL,
          params: {
            appInstanceId,
            intermediaryIdentifier: this.nodePublicIdentifier,
          },
        }),
      );
    }

    return uninstallResponse.result as NodeTypes.UninstallVirtualResult;
  };

  // TODO: erc20 support?
  public withdrawal = async (
    amount: BigNumber,
    recipient?: string, // Address or xpub? whats the default?
  ): Promise<NodeTypes.UninstallResult> => {
    const freeBalance = await this.getFreeBalance();
    const preWithdrawalBal = freeBalance[this.cfModule.ethFreeBalanceAddress];
    const err = [
      notLessThanOrEqualTo(amount, preWithdrawalBal),
      recipient ? invalidAddress(recipient) : null, // check address of asset
    ].filter(falsy)[0];
    if (err) {
      this.logger.error(err);
      throw new Error(err);
    }
    let withdrawalResponse;

    if (this.channelProvider) {
      withdrawalResponse = await this.channelProvider.withdrawal(amount, recipient)
    } else {
      withdrawalResponse = await this.cfModule.router.dispatch(
        jsonRpcDeserialize({
          id: Date.now(),
          jsonrpc: "2.0",
          method: NodeTypes.RpcMethodName.WITHDRAW,
          params: {
            amount,
            multisigAddress: this.multisigAddress,
            recipient,
          },
        }),
      );
    }

    return withdrawalResponse.result;
  };

  ///////////////////////////////////
  // LOW LEVEL METHODS

  // TODO: make sure types are all good
  private connectDefaultListeners = (): void => {
    // counterfactual listeners
    this.listener.registerDefaultCfListeners();
  };

  private appNotInstalled = async (appInstanceId: string): Promise<string | undefined> => {
    const apps = await this.getAppInstances();
    const app = apps.filter((app: AppInstanceInfo) => app.identityHash === appInstanceId);
    if (!app || app.length === 0) {
      return (
        `Could not find installed app with id: ${appInstanceId}.` +
        `Installed apps: ${JSON.stringify(apps, null, 2)}.`
      );
    }
    if (app.length > 1) {
      return (
        `CRITICAL ERROR: found multiple apps with the same id. ` +
        `Installed apps: ${JSON.stringify(apps, null, 2)}.`
      );
    }
    return undefined;
  };
}
