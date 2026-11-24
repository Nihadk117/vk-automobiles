export type ShopUser={id:number;username:string;role:"owner"|"staff"};
export const IDLE_MINUTES=15;
// HTML patterns use the Unicode-sets flag; a literal hyphen must be escaped.
export const USERNAME_PATTERN="[A-Za-z0-9][A-Za-z0-9._\\-]{2,39}";
