import { redirect } from "next/navigation";
import { configured } from "@/server/auth";
import { session } from "@/server/auth-http";
import { getDatabase } from "@/server/database";
import { LoginForm } from "./login-form";
export const dynamic="force-dynamic";
export default async function Login({searchParams}:{searchParams:Promise<{expired?:string}>}){
  const forceLock=(await searchParams).expired==="1";
  if(!forceLock&&await session(false))redirect("/shop/home");
  return <LoginForm setup={!configured(getDatabase())}/>;
}
