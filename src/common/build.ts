declare const __LOCAL_AI_AVAILABLE__: boolean;
// Source tests use the full feature set. Production builds define the edition explicitly.
export const LOCAL_AI_AVAILABLE = typeof __LOCAL_AI_AVAILABLE__ === 'undefined' || __LOCAL_AI_AVAILABLE__;
