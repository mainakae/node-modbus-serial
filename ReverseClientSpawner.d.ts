import events from 'events';
import { ModbusRTU } from './ModbusRTU';
import { FCallback, IServerOptions } from './ServerTCP';


export class ReverseClientSpawner extends events.EventEmitter {
    constructor(options: IServerOptions);
    close(cb: FCallback): void;
    destroy(): void;
}

export declare interface ReverseClientSpawner {
    on(event: 'newClient', listener: (client: ModbusRTU) => void): this;
}

