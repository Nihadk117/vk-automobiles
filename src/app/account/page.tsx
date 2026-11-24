import { requirePage } from "@/server/auth-http";
import { AccountWorkspace } from "./workspace";
export default async function Account(){return <AccountWorkspace user={await requirePage()}/>;}
