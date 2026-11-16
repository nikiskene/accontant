import { record } from '../features/einvoicing/details.ts';

export function invoiceBankDetails(instructions: string, bankSnapshot: unknown) {
  const bank = record(bankSnapshot);
  const intro: string[] = [];
  const accounts: string[][] = [];
  let account: string[] | undefined;

  for (const raw of instructions.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[A-Z]{3}(?:\s*\/\s*[A-Z]{3})*\s*:$/.test(line) ||
        (!account && /^(?:iban|account holder|account number|bank name|swift|bic)\b[^:]*:/i.test(line))) {
      account = [];
      accounts.push(account);
    }
    const previous = account?.[account.length - 1];
    if (account && previous && /^(?:iban|account holder(?: name)?|account number|bank name|swift(?:\s*\/\s*bic)?|bic)\s*:\s*$/i.test(previous) && !line.includes(':')) {
      account[account.length - 1] = `${previous} ${line}`;
    } else {
      (account || intro).push(line);
    }
  }

  const normalize = (value: unknown) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const snapshotIban = normalize(bank.iban);
  const snapshotNumber = normalize(bank.account_number);
  const matchingAccount = accounts.find(block => block.some((line, i) => {
    const match = line.match(/^(IBAN|Account Number)\s*:\s*(.*)$/i);
    if (!match) return false;
    const value = normalize(match[2] || block[i+1]);
    return !!value && value === (match[1].toUpperCase() === 'IBAN' ? snapshotIban : snapshotNumber);
  }));

  const snapshotFields = [
    ['Account holder', bank.account_name],
    ['Bank name', bank.bank_name],
    ['Account number', bank.account_number],
    ['IBAN', bank.iban],
    ['SWIFT / BIC', bank.bic_swift],
  ];
  if (matchingAccount) {
    for (const [label, value] of snapshotFields) {
      if (!value) continue;
      const field = normalize(label);
      const alreadyShown = matchingAccount.some(line => {
        const key = normalize(line.split(':')[0]);
        return key === field || (field === 'ACCOUNTHOLDER' && key === 'ACCOUNTHOLDERNAME') ||
          (field === 'SWIFTBIC' && (key === 'SWIFT' || key === 'BIC'));
      });
      if (!alreadyShown) matchingAccount.push(`${label}: ${value}`);
    }
  } else if (snapshotFields.some(([,value]) => !!value)) {
    const rows = snapshotFields.filter(([,value]) => !!value).map(([label,value]) => `${label}: ${value}`);
    if (accounts.length === 0) {
      accounts.push(rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2)));
    } else {
      accounts.push([...(bank.currency ? [`${bank.currency}:`] : []), ...rows]);
    }
  }

  const isAedAccount = (block: string[]) => /^AED(?:\s*[/ :]|$)/.test(block[0] || '');
  return {
    intro,
    accounts: [...accounts.filter(isAedAccount), ...accounts.filter(block => !isAedAccount(block))],
  };
}
