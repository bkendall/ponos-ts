import { expect } from "chai";
import { Server } from "../src/index.js";
import type {
  MessageActions,
  RabbitMQConnectionConfig,
  ServerOptions,
  WorkerData,
  WorkerFunction,
} from "../src/index.js";

describe("index", () => {
  it("should export Server and public types", () => {
    const options: ServerOptions = {
      name: "test",
      prefetch: 2,
      rabbitmq: { hostname: "localhost" } satisfies RabbitMQConnectionConfig,
    };
    const fn: WorkerFunction = async (_data: WorkerData) => {};
    const actionsCheck: MessageActions | undefined = undefined;
    expect(Server).to.be.a("function");
    expect(options.prefetch).to.equal(2);
    expect(fn).to.be.a("function");
    expect(actionsCheck).to.be.undefined;
  });
});
