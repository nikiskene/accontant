import {allocationAmounts, type Booking} from './model.ts';

// Follow the existing booking rules; visibility must never change stored choices.
export function receiptRequirements(booking: Booking, currency: string | null, baseCurrency?: string) {
 let inputVat=false,privateUse=false,nonDeductible=false;
 for(const line of booking.lines) {
  try {
   const amounts=allocationAmounts(line);
   inputVat ||= amounts.recoverableVat>0;
   privateUse ||= amounts.privateAmount>0;
   nonDeductible ||= amounts.nonDeductible>0;
  } catch {
   // Keep correction controls available for invalid imported allocations.
   inputVat ||= line.tax>0 && line.vat_recovery_percent>0;
   privateUse ||= line.private_percent>0;
   nonDeductible ||= line.deductible_percent<100;
  }
 }
 return {inputVat,privateUse,nonDeductible,
  explanation:booking.lines.some(line=>line.tax>0||line.private_percent>0||line.deductible_percent<100),
  exchangeRate:!!currency&&!!baseCurrency&&currency!==baseCurrency};
}
