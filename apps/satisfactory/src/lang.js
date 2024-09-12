"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LangKeys = void 0;
exports.getDisplayName = getDisplayName;
const fs_1 = __importDefault(require("fs"));
const rawData = fs_1.default.readFileSync(__dirname + '/lang/en-US.json', 'utf8');
const cleanData = JSON.parse(cleanUnicode(rawData));
var LangKeys;
(function (LangKeys) {
    LangKeys["Schematics"] = "/Script/CoreUObject.Class'/Script/FactoryGame.FGSchematic'";
})(LangKeys || (exports.LangKeys = LangKeys = {}));
function getDisplayName(nativeClassKey, className) {
    const selectedItem = cleanData.find((item) => item.NativeClass === nativeClassKey);
    if (!selectedItem) {
        return `NativeClass "${nativeClassKey}" not found`;
    }
    const selectedClass = selectedItem.Classes.find((c) => c.ClassName === className);
    if (!selectedClass) {
        return `ClassName "${className}" not found`;
    }
    return selectedClass.mDisplayName;
}
function cleanUnicode(text) {
    // This regex removes non-printable characters (including control characters)
    return text.replace(/[\u0000-\u001F\u007F-\u009F\u200B\uFEFF]/g, '');
}
