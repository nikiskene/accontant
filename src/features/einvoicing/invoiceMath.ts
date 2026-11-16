import {scaled,decimal} from './core.ts';
export function invoiceLineAmounts(quantity:number,unitPrice:number,vatRate:number,discountPercent=0){
 const q=scaled(quantity,4),p=scaled(unitPrice,2),r=scaled(vatRate,6),discount=scaled(discountPercent,4);
 if(discount===null||discount<0n||discount>1000000n||q===null||p===null||r===null||p<0n||r<0n||r>1000000n)throw new Error('Enter valid quantities, prices and tax rates.');
 const sign = q < 0n ? -1n : 1n;
 const netMagnitude = (q * sign * p * (1000000n - discount) + 5000000000n) / 10000000000n;
 const net = sign * netMagnitude;
 const tax = sign * ((netMagnitude * r + 500000n) / 1000000n);
 return {net:Number(decimal(net)),tax:Number(decimal(tax)),gross:Number(decimal(net+tax))};
}

type InvoiceLineAmounts = {
 net_amount: number | string;
 vat_amount: number | string;
 gross_amount: number | string;
};

export function hasInvoiceLineValue(line: InvoiceLineAmounts): boolean {
 return Number(line.net_amount) !== 0 || Number(line.vat_amount) !== 0 || Number(line.gross_amount) !== 0;
}
