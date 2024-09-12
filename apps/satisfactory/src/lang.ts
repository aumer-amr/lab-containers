import fs from 'fs';

const rawData = fs.readFileSync(__dirname + '/lang/en-US.json', 'utf8');
const cleanData = JSON.parse(cleanUnicode(rawData));

export enum LangKeys {
	'Schematics' = "/Script/CoreUObject.Class'/Script/FactoryGame.FGSchematic'"
}

export function getDisplayName(nativeClassKey: LangKeys, className: string) {
    const selectedItem = cleanData.find((item: any) => item.NativeClass === nativeClassKey);
    
    if (!selectedItem) {
        return `NativeClass "${nativeClassKey}" not found`;
    }

    const selectedClass = selectedItem.Classes.find((c: any) => c.ClassName === className);
    
    if (!selectedClass) {
        return `ClassName "${className}" not found`;
    }

    return selectedClass.mDisplayName;
}

function cleanUnicode(text: string): string {
    // This regex removes non-printable characters (including control characters)
    return text.replace(/[\u0000-\u001F\u007F-\u009F\u200B\uFEFF]/g, '');
}