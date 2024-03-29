import { NodeApiClient } from "./node";
import { MockNatsClient, MockWallet, nodeUrl } from "./testing/mocks";

describe("NodeApiClient", () => {
  let nodeClient: NodeApiClient;

  beforeEach(() => {
    nodeClient = new NodeApiClient({
      nats: new MockNatsClient(),
      nodeUrl,
      publicIdentifier: "xpubsomething",
      wallet: new MockWallet(),
    });
    expect(nodeClient).toBeInstanceOf(NodeApiClient);
  });

  test("should call the config method properly", async () => {
    jest.spyOn(nodeClient, "config");
    const message = await nodeClient.config();
    expect(nodeClient.config).toBeCalledTimes(1);
    expect(message).toStrictEqual({
      chainId: "mocks", // network that your channel is on
      nodePublicIdentifier: "x-pubcooolstuffs", // x-pub of node
      nodeUrl,
    });
  });
});
