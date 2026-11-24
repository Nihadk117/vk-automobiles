export async function shopFetch(input:RequestInfo|URL,init?:RequestInit){
  const response=await fetch(input,init);
  if(response.status===401){window.location.replace("/login?expired=1");throw new Error("Your session has ended. Sign in again.");}
  return response;
}
