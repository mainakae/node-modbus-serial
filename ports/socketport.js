"use strict";
var util = require("util");
var events = require("events");
var EventEmitter = events.EventEmitter || events;
var modbusSerialDebug = require("debug")("modbus-serial");

var crc16 = require("../utils/crc16");

/* TODO: const should be set once, maybe */
var MAX_TRANSACTIONS = 256; // maximum transaction to wait for
var MIN_DATA_LENGTH = 6;
var MIN_MBAP_LENGTH = 6;
var CRC_LENGTH = 2;

/**
 * Simulate a modbus-RTU port using modbus-TCP connection.
 *
 * @param socket
 * @param options
 * @constructor
 */
var SocketPort = function(socket, options) {
    var modbus = this;
    this._client = socket;
    this.openFlag = false;
    this.callback = null;
    this._transactionIdWrite = 1;

    // options
    if (typeof(options) === "undefined") options = {};

    // handle callback - call a callback function only once, for the first event
    // it will triger
    var handleCallback = function(had_error) {
        if (modbus.callback) {
            modbus.callback(had_error);
            modbus.callback = null;
        }
    };

    if (options.timeout) this._client.setTimeout(options.timeout);
    this._client.on("data", function(data) {
        var buffer;
        var crc;
        var length;

        // data recived
        modbusSerialDebug({ action: "receive socket port strings", data: data });

        // check data length
        while (data.length > MIN_MBAP_LENGTH) {
            // parse tcp header length
            length = data.readUInt16BE(4);

            // cut 6 bytes of mbap and copy pdu
            buffer = Buffer.alloc(length + CRC_LENGTH);
            data.copy(buffer, 0, MIN_MBAP_LENGTH);

            // add crc to message
            crc = crc16(buffer.slice(0, -CRC_LENGTH));
            buffer.writeUInt16LE(crc, buffer.length - CRC_LENGTH);

            // update transaction id and emit data
            modbus._transactionIdRead = data.readUInt16BE(0);
            modbus.emit("data", buffer);

            // debug
            modbusSerialDebug({ action: "parsed socket port", buffer: buffer, transactionId: modbus._transactionIdRead });

            // reset data
            data = data.slice(length + MIN_MBAP_LENGTH);
        }
    });

    this._client.on("close", function(had_error) {
        modbus.openFlag = false;
        modbusSerialDebug("Socket port: signal close: " + had_error);
        handleCallback(had_error);
    });

    this._client.on("error", function(had_error) {
        modbus.openFlag = false;
        modbusSerialDebug("Socket port: signal error: " + had_error);
        handleCallback(had_error);
    });

    this._client.on("timeout", function() {
        modbus.openFlag = false;
        modbusSerialDebug("Socket port: TimedOut");
        handleCallback(new Error("Socket Connection Timed Out."));
    });

    /**
     * Check if port is open.
     *
     * @returns {boolean}
     */
    Object.defineProperty(this, "isOpen", {
        enumerable: true,
        get: function() {
            return this.openFlag;
        }
    });

    EventEmitter.call(this);
};
util.inherits(SocketPort, EventEmitter);

/**
 * Simulate successful port open.
 *
 * @param callback
 */
SocketPort.prototype.open = function(callback) {
    modbus.openFlag = true;
    setTimeout(callback, 0);
};

/**
 * Simulate successful close port.
 *
 * @param callback
 */
SocketPort.prototype.close = function(callback) {
    this.callback = callback;
    modbusSerialDebug("Socket port: signal close: ");
    this._client.end();
};

/**
 * Simulate successful destroy port.
 *
 * @param callback
 */
SocketPort.prototype.destroy = function(callback) {
    this.callback = callback;
    if (!this._client.destroyed) {
        this._client.destroy();
    }
};

/**
 * Send data to a modbus-tcp slave.
 *
 * @param data
 */
SocketPort.prototype.write = function(data) {
    if(data.length < MIN_DATA_LENGTH) {
        modbusSerialDebug("expected length of data is to small - minimum is " + MIN_DATA_LENGTH);
        return;
    }

    // remember current unit and command
    this._id = data[0];
    this._cmd = data[1];

    // remove crc and add mbap
    var buffer = Buffer.alloc(data.length + MIN_MBAP_LENGTH - CRC_LENGTH);
    buffer.writeUInt16BE(this._transactionIdWrite, 0);
    buffer.writeUInt16BE(0, 2);
    buffer.writeUInt16BE(data.length - CRC_LENGTH, 4);
    data.copy(buffer, MIN_MBAP_LENGTH);

    modbusSerialDebug({
        action: "send socket port",
        data: data,
        buffer: buffer,
        unitid: this._id,
        functionCode: this._cmd,
        transactionsId: this._transactionIdWrite
    });

    // send buffer to slave
    this._client.write(buffer);

    // set next transaction id
    this._transactionIdWrite = (this._transactionIdWrite + 1) % MAX_TRANSACTIONS;
};

/**
 * TCP port for Modbus.
 *
 * @type {SocketPort}
 */
module.exports = SocketPort;
