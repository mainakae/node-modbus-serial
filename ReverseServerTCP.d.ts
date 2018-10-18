import events from 'events';
import {IServerOptions, IServiceVector, FCallback, FCallbackVal} from './ServerTCP';


export class ReverseServerTCP extends events.EventEmitter {
    constructor(vector: IServiceVector, options: IServerOptions);
    end(): void;
    destroy(): void;
    sendException(callback: FCallback, functionCode: number, exceptionCode: number): void;
}

export declare interface ReverseServerTCP {
    on(event: 'connect', listener: FCallback): this;
    on(event: 'closed', listener: FCallbackVal<boolean>): this;
    on(event: 'error', listener: FCallbackVal<Error>): this;
}

