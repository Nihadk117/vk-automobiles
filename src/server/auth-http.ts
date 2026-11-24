import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "./database";
import { sessionUser,requireOwner,SESSION_MS } from "./auth";
import { InventoryError } from "./inventory";
import { readWrite } from "./http";
export const cookieName=()=>`vk_session_${process.env.PORT||"3000"}`;
export async function session(touch=true){const token=(await cookies()).get(cookieName())?.value;return sessionUser(getDatabase(),token,Date.now(),touch);}
export async function requireUser(owner=false){const user=await session();if(!user)throw new InventoryError("Sign in to continue.",401);if(owner)requireOwner(user);return user;}
export async function authorizedWrite(request:Request,owner=false){
  await requireUser(owner);const body=await readWrite(request);
  // Recheck after awaiting the request body: a disabled or expired session must
  // not commit a request that was started while it was still valid.
  return {body,user:await requireUser(owner)};
}
export async function requirePage(owner=false){const user=await session(false);if(!user)redirect("/login");if(owner&&user.role!=="owner")redirect("/shop/home");return user;}
export async function setSessionCookie(token:string){(await cookies()).set(cookieName(),token,{httpOnly:true,sameSite:"strict",secure:(process.env.SHOP_ORIGIN||"").startsWith("https://"),path:"/",maxAge:SESSION_MS/1000});}
export async function clearSessionCookie(){(await cookies()).set(cookieName(),"",{httpOnly:true,sameSite:"strict",path:"/",maxAge:0});}
