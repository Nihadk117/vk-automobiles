import { test as base,expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
export const testPassword="Fictional-test-password-123";
export async function signIn(request:APIRequestContext,origin:string){
  const status=await(await request.get(`${origin}/api/auth`)).json();
  const r=await request.post(`${origin}/api/auth`,{headers:{Origin:origin},data:{action:status.configured?"login":"setup",data:{username:"test-owner",password:testPassword}}});
  expect(r.ok(),await r.text()).toBeTruthy();
}
export const test=base.extend({
  request:async({playwright,baseURL},provide)=>{const request=await playwright.request.newContext({baseURL});await signIn(request,baseURL!);await provide(request);await request.dispose();},
  page:async({page,baseURL},provide)=>{await signIn(page.request,baseURL!);await provide(page);},
});
export {expect};
