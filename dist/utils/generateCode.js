"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCode = void 0;
const nanoid_1 = require("nanoid");
// alphanumeric, avoids ambiguous chars
const nanoid = (0, nanoid_1.customAlphabet)('23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', 7);
const generateCode = () => nanoid();
exports.generateCode = generateCode;
//# sourceMappingURL=generateCode.js.map