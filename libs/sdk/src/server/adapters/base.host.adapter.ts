import { FrontMcpServer } from '../../common';

export abstract class HostServerAdapter extends FrontMcpServer {

  /**
   *  Start the server on the specified port
   */
  abstract override start(port: number): Promise<void> | void;
}

