/** DocFlow JSON mapping. This builds a validation candidate, never submits it. */
import {prepare,scaled,decimal,text,type Context,type Row,type Finding} from './core.ts';
export type DocFlowResult={payload:Row|null;findings:Finding[];ready:boolean;productionReady:false};
const object=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const abs=(n:bigint)=>n<0n?-n:n;
const amount=(v:unknown)=>{const value=scaled(v);if(value===null)throw new Error('Invalid monetary amount');return value;};
// Money remains integer cents until the final JSON serialization boundary.
const money=(v:bigint)=>{if(abs(v)>9007199254740991n)throw new Error('Amount exceeds JSON precision');return Number(decimal(v));};
const aed=(cents:bigint,rate:bigint)=>(cents*rate+50000000n)/100000000n;
const emirates:Record<string,string>={dubai:'DXB',dxb:'DXB','abu dhabi':'AUH',auh:'AUH',sharjah:'SHJ',shj:'SHJ',ajman:'AJM',ajm:'AJM','ras al khaimah':'RAK',rak:'RAK',fujairah:'FUJ',fuj:'FUJ','umm al quwain':'UAQ',uaq:'UAQ'};
export const emirateCode=(v:unknown)=>emirates[text(v).toLowerCase()]||'';
export function mapDocFlow(context:Context,companyId:string):DocFlowResult {
 const prepared=prepare(context),p=prepared.payload;
 // Foreign currencies and non-standard taxes can be locally mapped, but not certified.
 // Unsupported financial/scenario inputs remain blocking findings.
 const mappingReviews=new Set(['currency_review']);
 const findings=prepared.findings.filter(f=>!mappingReviews.has(f.field)&&!/^lines\.\d+\.tax_review$/.test(f.field));
 const require=(ok:boolean,field:string,message:string)=>{if(!ok)findings.push({field,message});};
 require(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId),'providerCompanyId','Connect this company’s Docflow sandbox account.');
 require(p.seller.registrationType==='TL','seller.registrationType','This validation route currently supports trade-licence sellers. Other registration types require provider acceptance.');
 require(['10','30','42','58'].includes(p.paymentMeans),'payment_provider_contract','Card and direct-debit details need Docflow’s payment schema before validation.');
 require(!!p.number,'number','Issue the invoice to assign its final number before provider validation.');
 require(p.documentType==='invoice','credit_provider_contract','Credit-note reason codes and preceding-invoice JSON must be confirmed with Docflow before provider validation.');
 require(!!text(p.buyer.vatNumber),'buyer.vatNumber','Confirm the buyer VAT TRN for this tax-invoice route. Non-VAT buyers need the separate provider-approved identity route.');
 const sellerRegion=emirateCode(p.seller.subdivision),buyerRegion=emirateCode(p.buyer.subdivision);
 require(!!sellerRegion,'seller.subdivision','Choose the seller emirate in Company credentials.');
 if(p.buyer.country==='AE')require(!!buyerRegion,'buyer.subdivision','Choose the customer emirate.');
 const reference=text(context.metadata.buyer_reference),purchaseOrder=text(context.metadata.purchase_order);
 require(!!reference||!!purchaseOrder,'buyer_reference','Enter the customer’s buyer reference or purchase-order number for invoice routing. A purchase-order system is not needed.');
 if(findings.length)return {payload:null,findings,ready:false,productionReady:false};
 try{
  const rate=scaled(p.exchangeRate,8)!;
  const taxGroups=new Map<string,{categoryCode:string;rate:number;net:bigint;tax:bigint;reason:string;reasonCode:string}>();
  const overrides=object(context.metadata.lines);
  const lines=p.lines.map((line,index)=>{
   const source=context.lines[index],override=object(overrides[text(source.id)]);
   const category=text(line.taxCategory),percent=Number(line.vatRate)*100;
   const net=amount(line.net),tax=amount(line.tax),gross=amount(line.gross);
   const reason=text(line.taxReason),reasonCode=text(override.tax_reason_code);
   // No silently inferred exemption codes; the source must supply applicable codes.
   if(category==='E'&&!reasonCode)throw new Error(`Line ${index+1}: enter the provider-approved VAT exemption code.`);
   const key=`${category}:${percent}`;
   const group=taxGroups.get(key)||{categoryCode:category,rate:percent,net:0n,tax:0n,reason,reasonCode};
   if(group.reasonCode!==reasonCode||group.reason!==reason)throw new Error(`Line ${index+1}: tax reasons differ within the same VAT group. Review the tax treatment.`);
   group.net+=net;group.tax+=tax;taxGroups.set(key,group);
   const unitPrice=amount(line.unitPrice),unit=text(line.unit);
   return {lineNo:Number(source.line_no)||index+1,item:{name:text(override.item_name)||text(line.description),description:text(line.description)},quantity:Number(line.quantity),unitCode:unit,
    price:{grossPrice:money(unitPrice),priceDiscount:0,netPrice:money(unitPrice),baseQuantity:1,baseQuantityUnitCode:unit},
    tax:{scheme:'VAT',categoryCode:category,rate:percent,...(reason?{exemptionReasonText:reason}:{}),...(reasonCode?{exemptionReasonCode:reasonCode}:{})},
    amounts:{lineExtensionAmount:money(net),taxAmount:money(tax),lineTotalAmount:money(gross),...(category!=='E'?{taxAmountAed:money(aed(tax,rate))}:{}),lineTotalAmountAed:money(aed(gross,rate))}};
  });
  const net=amount(p.totals.net),tax=amount(p.totals.tax),gross=amount(p.totals.gross);
  const bank=object(context.document.bank_snapshot),bankId=text(bank.iban||bank.account_number);
  const transfer=['30','42','58'].includes(p.paymentMeans);
  if(transfer&&!bankId)throw new Error('Choose a company bank account on the invoice before validating bank-transfer payment instructions.');
  const seller={registeredName:p.seller.name,electronicAddress:{id:p.seller.tin,schemeId:'0235'},taxIdentifier:{id:p.seller.vatNumber,schemeCode:'VAT'},taxRegistration:{id:p.seller.tin,schemeId:'TAX'},legalRegistration:{id:p.seller.registrationNumber,typeCode:p.seller.registrationType,authorityName:p.seller.authority},address:{line1:p.seller.address,city:p.seller.city,countrySubdivision:sellerRegion,countryCode:'AE'}};
  const buyer={registeredName:p.buyer.name,electronicAddress:{id:p.buyer.electronicAddress,schemeId:p.buyer.scheme},taxIdentifier:{id:p.buyer.vatNumber,schemeCode:'VAT'},address:{line1:p.buyer.address,city:p.buyer.city,countrySubdivision:buyerRegion,countryCode:p.buyer.country}};
  const payload:Row={companyId,isDraft:true,isSelfBilled:false,invoiceNo:p.number,documentId:p.documentId,issueDate:p.issueDate,invoiceTypeCode:'380',invoiceTransactionTypeCode:p.transactionType,currencyCode:p.currency,dueDate:p.dueDate,supplyDate:p.supplyDate,
   references:{...(reference?{buyerReference:reference}:{}),...(purchaseOrder?{purchaseOrder}:{})},seller,buyer,lines,
   taxBreakdown:[...taxGroups.values()].map(group=>({scheme:'VAT',categoryCode:group.categoryCode,rate:group.rate,taxableAmount:money(group.net),taxAmount:money(group.tax),...(group.reason?{exemptionReasonText:group.reason}:{}),...(group.reasonCode?{exemptionReasonCode:group.reasonCode}:{})})),
   totals:{lineExtensionTotal:money(net),allowanceTotal:0,chargeTotal:0,taxExclusiveAmount:money(net),taxTotal:money(tax),taxInclusiveAmount:money(gross),prepaidAmount:0,roundingAmount:0,payableAmount:money(gross)},
   ...(p.currency!=='AED'?{taxCurrency:{code:'AED',exchangeRate:Number(p.exchangeRate),taxTotal:money(aed(tax,rate)),taxInclusiveAmount:money(aed(gross,rate))}}:{}),
   paymentInstructions:[{id:'PI-1',meansCode:p.paymentMeans,paymentId:p.number,...(transfer?{bankTransfer:{accountId:bankId,accountScheme:bank.iban?'IBAN':null,accountName:text(bank.account_name)||text(p.seller.name),bankIdentifier:text(bank.bic_swift),bankCountryCode:'AE'}}:{})}]};
  return {payload,findings:[],ready:true,productionReady:false};
 }catch(error){return {payload:null,findings:[{field:'mapping',message:error instanceof Error?error.message:'Invoice mapping failed.'}],ready:false,productionReady:false};}
}
