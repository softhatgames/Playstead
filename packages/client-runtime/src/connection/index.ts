export {
  type ConnectionPhase,
  type ConnectionState,
  type LocalConnection,
  type LocalConnectionTarget,
  type LocalCredential,
  makeLocalConnection,
} from "./local.ts";
export { ConnectionTransientError, type WsRpcClient } from "../rpc/session.ts";
