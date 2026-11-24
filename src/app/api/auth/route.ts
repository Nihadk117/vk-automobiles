import { cookies } from "next/headers";
import { z } from "zod";
import { getDatabase } from "@/server/database";
import { configured,setupOwner,login,logout,changePassword,recoverOwner } from "@/server/auth";
import { cookieName,session,requireUser,setSessionCookie,clearSessionCookie } from "@/server/auth-http";
import { readWrite,apiError } from "@/server/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){try{return Response.json({configured:configured(getDatabase()),user:await session(false)},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
export async function POST(request:Request){
  try{
    const input=z.object({action:z.enum(["setup","login","logout","touch","password","recover"]),data:z.unknown().optional()}).parse(await readWrite(request));
    const db=getDatabase();
    if(input.action==="setup"||input.action==="login"){
      const result=input.action==="setup"?setupOwner(db,input.data):login(db,input.data);
      await setSessionCookie(result.token);return Response.json({user:result.user,...("recoveryCode" in result?{recoveryCode:result.recoveryCode}:{})},{headers:{"Cache-Control":"no-store"}});
    }
    if(input.action==="recover"){const result=recoverOwner(db,input.data);await clearSessionCookie();return Response.json(result,{headers:{"Cache-Control":"no-store"}});}
    if(input.action==="logout"){logout(db,(await cookies()).get(cookieName())?.value);await clearSessionCookie();return Response.json({signedOut:true});}
    const user=await requireUser();
    if(input.action==="password"){changePassword(db,user,input.data);await clearSessionCookie();return Response.json({signedOut:true});}
    return Response.json({user},{headers:{"Cache-Control":"no-store"}});
  }catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues[0]?.message||"Check your account details."},{status:400,headers:{"Cache-Control":"no-store"}});return apiError(e);}
}
