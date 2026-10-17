export {
  type ConnectionPhase,
  type ConnectionState,
  type ConnectionWakeup,
  type LocalConnection,
  type LocalConnectionOptions,
  type LocalConnectionTarget,
  type LocalCredential,
  makeLocalConnection,
} from "./local.ts";
export { ConnectionTransientError, type WsRpcClient } from "../rpc/session.ts";
