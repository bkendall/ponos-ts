import { expect } from "chai";
import { Server } from "../src/index.js";

describe("index", () => {
  it("should export Server", () => {
    expect(Server).to.be.a("function");
  });
});
