import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'https://samly.cc','Access-Control-Allow-Headers':'authorization, apikey, content-type'};
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`${name} is not configured`);return value;};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const prices={monthly:()=>env('SAMLY_STRIPE_MONTHLY_PRICE_ID'),annual:()=>env('SAMLY_STRIPE_ANNUAL_PRICE_ID')};
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);try{
 const auth=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
 const {data:{user},error:authError}=await auth.auth.getUser();if(authError||!user)return json({error:'Sign in required'},401);
 const {plan}=await req.json();if(plan!=='monthly'&&plan!=='annual')return json({error:'Choose monthly or annual'},400);
 const admin=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
 const {data:account,error}=await admin.from('samly_accounts').select('id,billing_email,stripe_customer_id,plan_code,subscription_status').eq('owner_user_id',user.id).maybeSingle();if(error)throw error;if(!account)return json({error:'Create your Samly workspace before choosing a plan.'},409);if(account.plan_code==='lifetime'&&account.subscription_status==='active')return json({error:'Your lifetime plan is already active.'},409);
 const form=new URLSearchParams({mode:'subscription',success_url:'https://samly.cc/samly/app?checkout=success',cancel_url:'https://samly.cc/#pricing','line_items[0][price]':prices[plan](),'line_items[0][quantity]':'1',client_reference_id:account.id,'metadata[account_id]':account.id,'metadata[plan]':plan,'subscription_data[metadata][account_id]':account.id,'subscription_data[metadata][plan]':plan,allow_promotion_codes:'true'});
 if(account.stripe_customer_id)form.set('customer',account.stripe_customer_id);else if(account.billing_email)form.set('customer_email',account.billing_email);
 const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${env('STRIPE_SECRET_KEY')}`,'Content-Type':'application/x-www-form-urlencoded'},body:form});if(!response.ok)throw new Error(`Stripe checkout failed (${response.status})`);const session=await response.json();return json({url:session.url});
 }catch(error){console.error(error);return json({error:error instanceof Error?error.message:'Checkout could not be started'},500)}});
