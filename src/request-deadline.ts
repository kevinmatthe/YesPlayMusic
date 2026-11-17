/** A timed-out write may already have reached the server. Callers must retain
 * its original idempotent intent and describe the result as unconfirmed. */
export class RequestDeadline extends Error {
 constructor(){super('保存结果未能确认，请重试。');this.name='RequestDeadline'}
}
export async function withWriteDeadline<T>(action:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 const controller=new AbortController()
 let timer:ReturnType<typeof setTimeout>|undefined
 const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{const error=new RequestDeadline();reject(error);controller.abort(error)},15000)})
 try{return await Promise.race([action(controller.signal),deadline])}
 finally{clearTimeout(timer)}
}
