export declare const PRERENDER_OUTLET: string;
export declare const PRERENDER_BASE_PLACEHOLDER: string;
export declare function validatePrerenderedStartScreen(fragment: string): string;
export declare function injectPrerenderedStartScreen(template: string, fragment: string): string;
export declare function applyPrerenderedBasePath(fragment: string, base: string): string;
export declare function ensureCriticalStylesheetBeforeModule(html: string): string;
