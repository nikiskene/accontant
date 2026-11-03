import {scaled,decimal} from './core.ts';
export function invoiceLineAmounts(quantity:number,unitPrice:number,vatRate:number,discountPercent=0){
 const q=scaled(quantity,4),p=scaled(unitPrice,2),r=scaled(vatRate,6),discount=scaled(discountPercent,4);
 if(discount===null||discount<0n||discount>1000000n||q===null||p===null||r===null||q<0n||p<0n||r<0n||r>1000000n)throw new Error('Enter valid quantities, prices and tax rates.');
 const net=(q*p*(1000000n-discount)+5000000000n)/10000000000n,tax=(net*r+500000n)/1000000n;
 return {net:Number(decimal(net)),tax:Number(decimal(tax)),gross:Number(decimal(net+tax))};
}
