/** Starting points for handover instructions. Every "______" is a gap to fill in. */
export const TEMPLATES: Array<{ id: string; label: string; text: string }> = [
  {
    id: 'developer',
    label: 'Developer',
    text: `If you are reading this, I can't look after my systems right now. Thank you for helping.

FIRST 24 HOURS: nothing is on fire
- Everything keeps running on its own. Don't change anything in a hurry.
- Tell my clients (list below) that I'm unavailable and you're the contact for now.

WHERE THE KEYS ARE
- Password manager: ______ (emergency kit / recovery sheet is in ______)
- Hardware security keys (YubiKey etc.): ______  PIN is in ______
- Phone unlock / 2FA codes by SMS go to: ______
- Printed handover document / USB drive: ______

WHAT RUNS WHERE
- Servers / hosting: ______ (provider, account email, support number)
- Domains & DNS: registrar ______, renewals due ______
- Code: GitHub / GitLab account ______
- Email: ______
- Payments & billing: Stripe / bank ______

PEOPLE
- Clients to contact first: ______
- A developer I trust who can take over: ______
- Accountant / solicitor: ______

MONEY
- Monthly costs that must keep being paid: ______
- What can be safely switched off: ______
`,
  },
  {
    id: 'business',
    label: 'Small business',
    text: `If you are reading this, I can't run the business right now. Thank you for stepping in.

FIRST FEW DAYS
- Staff to tell first, and who is in charge day to day: ______
- Customers or orders that can't wait: ______
- It is fine to close / pause for a while: yes / no. If yes, how to tell customers: ______

WHERE THE KEYS ARE
- Password manager or password book: ______
- Keys to the premises, alarm code is kept: ______
- Business phone and its unlock code: ______

MONEY
- Business bank: ______ (who else can sign: ______)
- Payroll: ______ (runs on ______)
- Bills and suppliers that must be paid: ______
- Card machine / till / online shop: ______

PEOPLE TO CALL
- Accountant: ______
- Solicitor: ______
- Key suppliers: ______
- Insurance (policy numbers are in ______): ______

PAPERWORK
- Contracts, leases and licences are kept: ______
- My wishes for the business if I can't come back: ______
`,
  },
  {
    id: 'creative',
    label: 'Creative work',
    text: `If you are reading this, I can't look after my work right now. Thank you for taking care of it.

WHERE MY WORK IS
- Originals and master files: ______
- Backups (cloud and physical): ______
- Unfinished work, and what I'd like done with it: ______

ACCOUNTS
- Password manager: ______
- Website / portfolio / online shop: ______
- Where my work is sold or published: ______

PEOPLE
- Clients with work in progress, and deadlines: ______
- Agent / publisher / gallery / label: ______
- Someone I trust to finish or look after my work: ______

RIGHTS AND MONEY
- Royalties and income arrive via: ______
- Contracts and rights paperwork are kept: ______
- My wishes for my work (publish, archive, keep private): ______
`,
  },
  {
    id: 'household',
    label: 'Household & family',
    text: `If you are reading this, I can't look after things at home right now. Thank you for helping.

FIRST THINGS
- Who needs to know first: ______
- Anyone who depends on me day to day (children, parents, pets): ______
- Bills that must not be missed this month: ______

WHERE THINGS ARE
- Important documents (passports, deeds, birth certificates): ______
- My will and who holds a copy: ______
- Password manager or password book: ______
- My phone's unlock code is kept: ______

MONEY
- Bank accounts: ______
- Pensions and savings: ______
- Insurance policies (life, home, car): ______
- Regular payments and direct debits to review: ______

PEOPLE TO CALL
- Solicitor: ______
- Financial adviser / accountant: ______
- Employer: ______

MY WISHES
- ______
`,
  },
  {
    id: 'general',
    label: 'Anything else',
    text: `If you are reading this, I can't look after things myself right now. Thank you for helping.

1. WHAT MATTERS MOST AND MUST NOT BE LOST
- ______

2. WHERE THE KEYS, PASSWORDS AND CODES ARE
- ______

3. WHO TO CALL, AND IN WHAT ORDER
- ______

4. WHAT MUST KEEP RUNNING, AND WHAT CAN STOP
- ______

5. MY WISHES
- ______
`,
  },
]
