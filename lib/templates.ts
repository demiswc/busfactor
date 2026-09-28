/** Starting points for handover instructions. Every "______" is a gap to fill in. */
export const TEMPLATES: Array<{ id: string; label: string; text: string }> = [
  {
    id: 'pointer',
    label: 'Point to my full plan',
    text: `If you are reading this, I can't look after things myself right now. Thank you for helping.

MY FULL CONTINUITY PLAN IS HERE
- Where it is: ______ (e.g. printed in the fire safe / encrypted USB drive in ______ / shared folder ______)
- How to open it: ______ (e.g. password manager emergency access, the PIN on the card in ______)
- Start with its "First 24 hours" section.

IF YOU CANNOT FIND IT
- Call first: ______ (phone ______). They know where things are.
- Then: ______

THE THREE THINGS THAT MATTER MOST
1. ______
2. ______
3. ______
`,
  },
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
    id: 'platform',
    label: 'Platform or SaaS',
    text: `If you are reading this, I can't run the platform right now. Thank you for keeping it alive.
Customers depend on it, so please read the first section before touching anything.

1. FIRST 24 HOURS: KEEP THE LIGHTS ON
- The platform runs on its own. Do not change, restart or delete anything in a hurry.
- Check it is up: ______ (status page / health URL / monitoring login)
- Tell these people I am unavailable and you are the contact for now: ______
- If it goes down, call: ______ (hosting support / a developer I trust)

2. KEY PEOPLE
- Business partner / co-director: ______
- A developer who could take over: ______
- Accountant: ______   Solicitor: ______
- Important customers to reassure first: ______

3. WHERE THE KEYS ARE
- Password manager: ______ (emergency access / recovery kit in ______)
- Hardware keys (YubiKey etc.) and their PINs: ______
- Server root / SSH access: ______
- Two-factor codes go to: ______

4. WHAT RUNS WHERE
- Servers and hosting: ______ (provider, account, support number)
- Domains and DNS: registrar ______, renewals due ______
- Database and backups: ______ (where backups go, how to restore)
- Code: repository ______, how to deploy: ______
- Email and other services: ______

5. MONEY
- Payment providers (Stripe etc.) and where the money goes: ______
- Monthly costs that must keep being paid: ______
- Income: who pays, how, and when: ______
- Insurance policies: ______

6. SHORT TERM (FIRST WEEK)
- ______

7. MEDIUM TERM (FIRST MONTH)
- Decide: keep running with a hired developer / sell / wind down gently.
- Hiring a replacement developer: the skills needed are ______; a technical handover document is at ______

8. MY WISHES FOR THE PLATFORM
- ______
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
