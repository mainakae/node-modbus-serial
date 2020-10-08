"use strict";
var util = require("util");
var events = require("events");
var EventEmitter = events.EventEmitter || events;
var net = require("net");
var modbusSerialDebug = require("debug")("modbus-serial");

var crc16 = require("../utils/crc16");
var calculateLrc = require("../utils/lrc");

/* TODO: const should be set once, maybe */
var MIN_DATA_LENGTH = 6;

var TELNET_PORT = 2217;


// FIXME: modbus ex
/**
 * Ascii encode a 'request' buffer and return it. This includes removing
 * the CRC bytes and replacing them with an LRC.
 *
 * @param {Buffer} buf the data buffer to encode.
 * @return {Buffer} the ascii encoded buffer
 * @private
 */
function _asciiEncodeRequestBuffer(buf) {

    // replace the 2 byte crc16 with a single byte lrc
    buf.writeUInt8(calculateLrc(buf.slice(0, -2)), buf.length - 2);

    // create a new buffer of the correct size
    var bufAscii = Buffer.alloc(buf.length * 2 + 1); // 1 byte start delimit + x2 data as ascii encoded + 2 lrc + 2 end delimit

    // create the ascii payload

    // start with the single start delimiter
    bufAscii.write(":", 0);
    // encode the data, with the new single byte lrc
    // bufAscii.write(buf.toString("hex", 0, buf.length - 1).toUpperCase(), 1);     // uncomment if LRC is well calculated
    bufAscii.write(buf.toString("hex", 0, buf.length - 2).toUpperCase(), 1);    // FIX for tesyse wrong LRC
    // end with the two end delimiters
    bufAscii.write(calculateLrc(bufAscii.slice(1, -2))      // REMOVE this if lrc is well calulated
        .toString(16)
        .toUpperCase(), bufAscii.length - 4);
    bufAscii.write("\r", bufAscii.length - 2);
    bufAscii.write("\n", bufAscii.length - 1);

    return bufAscii;
}

// FIXME: modbus ex
/**
 * Ascii decode a 'response' buffer and return it.
 *
 * @param {Buffer} bufAscii the ascii data buffer to decode.
 * @return {Buffer} the decoded buffer, or null if decode error
 * @private
 */
function _asciiDecodeResponseBuffer(bufAscii) {

    // create a new buffer of the correct size (based on ascii encoded buffer length)
    var bufDecoded = Buffer.alloc((bufAscii.length - 1) / 2);

    // decode into new buffer (removing delimiters at start and end)
    for (var i = 0; i < (bufAscii.length - 3) / 2; i++) {
        bufDecoded.write(String.fromCharCode(bufAscii.readUInt8(i * 2 + 1), bufAscii.readUInt8(i * 2 + 2)), i, 1, "hex");
    }


    // FIX for modbus EX (which doesn't calculate LRC right)
    var lrcIn = bufDecoded.readUInt8(bufDecoded.length - 2);
    if(calculateLrc(calculateLrc(bufAscii.slice(1, -2)) !== lrcIn) {
        // return null if lrc error
        var calcLrc = calculateLrc(bufDecoded.slice(0, -2));

        modbusSerialDebug({ action: "LRC error", LRC: lrcIn.toString(16), calcLRC: calcLrc.toString(16) });
        return null;
    }

    // check the lrc is true
    // var lrcIn = bufDecoded.readUInt8(bufDecoded.length - 2);
    // if(calculateLrc(bufDecoded.slice(0, -2)) !== lrcIn) {
    //     // return null if lrc error
    //     var calcLrc = calculateLrc(bufDecoded.slice(0, -2));

    //     modbusSerialDebug({ action: "LRC error", LRC: lrcIn.toString(16), calcLRC: calcLrc.toString(16) });
    //     return null;
    // }

    // replace the 1 byte lrc with a two byte crc16
    bufDecoded.writeUInt16LE(crc16(bufDecoded.slice(0, -2)), bufDecoded.length - 2);

    return bufDecoded;
}

/**
 * check if a buffer chunk can be a modbus answer
 * or modbus exception
 *
 * @param {AsciiTelnetPort} modbus
 * @param {Buffer} buf the buffer to check.
 * @return {boolean} if the buffer can be an answer
 * @private
 */
function _checkData(modbus, buf) {
    // check buffer size
    if (buf.length !== modbus._length && buf.length !== 5) {
        modbusSerialDebug({ action: "length error", recive: buf.length, expected: modbus._length });

        return false;
    }

    // check buffer unit-id and command
    return (buf[0] === modbus._id &&
        (0x7f & buf[1]) === modbus._cmd);
}

/**
 * Simulate a modbus-RTU port using Telent connection.
 *
 * @param ip
 * @param options
 * @constructor
 */
var AsciiTelnetPort = function(ip, options) {
    var self = this;
    this.ip = ip;
    this.openFlag = false;
    this.callback = null;

    // options
    if (typeof options === "undefined") options = {};
    this.port = options.port || TELNET_PORT; // telnet server port

    // internal buffer
    this._buffer = Buffer.alloc(0);
    this._id = 0;
    this._cmd = 0;
    this._length = 0;

    // handle callback - call a callback function only once, for the first event
    // it will triger
    var handleCallback = function(had_error) {
        if (self.callback) {
            self.callback(had_error);
            self.callback = null;
        }
    };

    // create a socket
    this._client = new net.Socket();
    if (options.timeout) this._client.setTimeout(options.timeout);

    // register the port data event
    this._client.on("data", function onData(data) {

        // add new data to buffer
        self._buffer = Buffer.concat([self._buffer, data]);

        modbusSerialDebug({ action: "receive ascii telnet port", data: data, buffer: self._buffer });
        modbusSerialDebug(JSON.stringify({ action: "receive ascii telnet port strings", data: data, buffer: self._buffer }));

        // check buffer for start delimiter
        var sdIndex = self._buffer.indexOf(0x3A); // ascii for ':'
        if(sdIndex === -1) {
            // if not there, reset the buffer and return
            self._buffer = Buffer.from("");
            return;
        }
        // if there is data before the start delimiter, remove it
        if(sdIndex > 0) {
            self._buffer = self._buffer.slice(sdIndex);
        }
        // do we have the complete message (i.e. are the end delimiters there)
        if(self._buffer.includes("\r\n", 1, "ascii") === true) {
            // check there is no excess data after end delimiters
            var edIndex = self._buffer.indexOf(0x0A); // ascii for '\n'
            if(edIndex !== self._buffer.length - 1) {
                // if there is, remove it
                self._buffer = self._buffer.slice(0, edIndex + 1);
            }

            // we have what looks like a complete ascii encoded response message, so decode
            var _data = _asciiDecodeResponseBuffer(self._buffer);
            modbusSerialDebug({ action: "got EOM", data: _data, buffer: self._buffer });
            if(_data !== null) {

                // check if this is the data we are waiting for
                if (_checkData(self, _data)) {
                    modbusSerialDebug({ action: "emit data ascii telnet port", data: data, buffer: self._buffer });
                    modbusSerialDebug(JSON.stringify({ action: "emit data ascii telnet port strings", data: data, buffer: self._buffer }));
                    // emit a data signal
                    self.emit("data", _data);
                }
            }
            // reset the buffer now its been used
            self._buffer = Buffer.from("");
        } else {
            // otherwise just wait for more data to arrive
        }

    });

    this._client.on("connect", function() {
        self.openFlag = true;
        handleCallback();
    });

    this._client.on("close", function(had_error) {
        self.openFlag = false;
        handleCallback(had_error);
    });

    this._client.on("error", function(had_error) {
        self.openFlag = false;
        handleCallback(had_error);
    });

    this._client.on("timeout", function() {
        self.openFlag = false;
        modbusSerialDebug("AsciiTelnetPort port: TimedOut");
        handleCallback(new Error("AsciiTelnetPort Connection Timed Out."));
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
util.inherits(AsciiTelnetPort, EventEmitter);

/**
 * Simulate successful port open.
 *
 * @param callback
 */
AsciiTelnetPort.prototype.open = function(callback) {
    this.callback = callback;
    this._client.connect(this.port, this.ip);
};

/**
 * Simulate successful close port.
 *
 * @param callback
 */
AsciiTelnetPort.prototype.close = function(callback) {
    this.callback = callback;
    this._client.end();
};

/**
 * Simulate successful destroy port.
 *
 * @param callback
 */
AsciiTelnetPort.prototype.destroy = function(callback) {
    this.callback = callback;
    if (!this._client.destroyed) {
        this._client.destroy();
    }
};

/**
 * Send data to a modbus slave via telnet server.
 *
 * @param {Buffer} data
 */
AsciiTelnetPort.prototype.write = function(data) {
    if(data.length < MIN_DATA_LENGTH) {
        modbusSerialDebug("expected length of data is to small - minimum is " + MIN_DATA_LENGTH);
        return;
    }

    var length = null;

    // remember current unit and command
    this._id = data[0];
    this._cmd = data[1];

    // calculate expected answer length (this is checked after ascii decoding)
    switch (this._cmd) {
        case 1:
        case 2:
            length = data.readUInt16BE(4);
            this._length = 3 + parseInt((length - 1) / 8 + 1) + 2;
            break;
        case 3:
        case 4:
            length = data.readUInt16BE(4);
            this._length = 3 + 2 * length + 2;
            break;
        case 5:
        case 6:
        case 15:
        case 16:
            this._length = 6 + 2;
            break;
        default:
            // raise and error ?
            modbusSerialDebug({ action: "unknown command", id: this._id.toString(16), command: this._cmd.toString(16) });
            this._length = 0;
            break;
    }

    // ascii encode buffer
    var _encodedData = _asciiEncodeRequestBuffer(data);

    // send buffer to slave
    this._client.write(_encodedData);

    modbusSerialDebug({
        action: "send ascii telnet port",
        data: _encodedData,
        unitid: this._id,
        functionCode: this._cmd
    });

    modbusSerialDebug(JSON.stringify({
        action: "send ascii telnet port",
        data: _encodedData,
        unitid: this._id,
        functionCode: this._cmd
    }));
};

/**
 * Telnet port for Modbus.
 *
 * @type {AsciiTelnetPort}
 */
module.exports = AsciiTelnetPort;
