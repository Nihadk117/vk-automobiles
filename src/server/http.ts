import "server-only";
import { ZodError } from "zod";
import { InventoryError } from "./inventory";
export function verifyWrite(request:Request){
  const expected=process.env.SHOP_ORIGIN||`http://127.0.0.1:${process.env.PORT||"3000"}`;
  if(request.headers.get("origin")!==expected||request.headers.get("host")!==new URL(expected).host)
    throw new InventoryError("Request origin is not allowed.",403);
}
export async function readWrite(request:Request){
  verifyWrite(request);
  if(!request.headers.get("content-type")?.includes("application/json"))
    throw new InventoryError("JSON is required.",415);
  const text=await request.text();
  if(text.length>131072)throw new InventoryError("Request is too large.",413);
  return JSON.parse(text) as unknown;
}
export function apiError(error:unknown){
  if(error instanceof InventoryError)return Response.json({error:error.message},{status:error.status,headers:{"Cache-Control":"no-store"}});
  if(error instanceof ZodError||error instanceof SyntaxError)
    return Response.json({error:"Check the part details, quantities, price and adjustment reason."},{status:400});
  console.error("Inventory request failed");
  return Response.json({error:"Request failed. Reload and check stock before retrying."},{status:500});
}
export function partId(raw:string){
  const id=Number(raw);
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(id)||id<1)throw new InventoryError("Invalid part number.",400);
  return id;
}
