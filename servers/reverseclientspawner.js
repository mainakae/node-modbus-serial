"use strict";
/**
 * Copyright (c) 2017, Yaacov Zamir <kobi.zamir@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF  THIS SOFTWARE.
 */
var ModbusRTU = require("../index");
var util = require("util");
var events = require("events");
var EventEmitter = events.EventEmitter || events;
var net = require("net");
var modbusSerialDebug = require("debug")("modbus-serial");

var HOST = "127.0.0.1";
var MODBUS_PORT = 502;

/**
 * Class making ReverseClientSpawner.
 *
 * @param options - server options (host (IP), port, debug (true/false), unitID)
 * @constructor
 */
var ReverseClientSpawner = function(options) {
    var modbus = this;
    options = options || {};

    // create a tcp server
    modbus._server = net.createServer();
    modbus._server.listen(options.port || MODBUS_PORT, options.host || HOST);


    modbus._server.on("connection", function(sock) {
        modbusSerialDebug({
            action: "spawning new client",
            address: sock.address(),
            remoteAddress: sock.remoteAddress,
            remotePort: sock.remotePort
        });

        const client = new ModbusRTU();
        client.connectSocket(sock, { timeout: options.timeout }, function() {
            modbus.emit("newClient", client);
        });
    });
    EventEmitter.call(this);
};
util.inherits(ReverseClientSpawner, EventEmitter);

/**
* Delegate the close server method to backend.
*
* @param callback
*/
ReverseClientSpawner.prototype.close = function(callback) {
    // close the net port if exist
    if (this._server) {
        this._server.removeAllListeners("data");
        this._server.close(callback);

        modbusSerialDebug({ action: "close server" });
    } else {
        modbusSerialDebug({ action: "close server", warning: "server already closed" });
    }
};

/**
 * ServerTCP interface export.
 * @type {ReverseClientSpawner}
 */
module.exports = ReverseClientSpawner;
