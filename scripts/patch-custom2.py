def edit(f, pairs):
    s=open(f,encoding='utf8',newline='').read(); crlf='\r\n' in s; s=s.replace('\r\n','\n')
    for a,b in pairs:
        if a not in s: raise SystemExit('missing in %s: %s'%(f,a[:60]))
        s=s.replace(a,b)
    open(f,'w',encoding='utf8',newline='').write(s.replace('\n','\r\n') if crlf else s)
E="z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'])"
edit('server/src/schemas/index.ts',[
("import { z } from 'zod';\n","import { z } from 'zod';\n\n/** none, daily, weekdays, weekly, monthly, yearly, or a custom \"every:<n>:<day|week|month|year>\" such as every:3:day. */\nexport const recurrenceSchema = z.union([z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']), z.string().regex(/^every:[1-9]\\d{0,2}:(day|week|month|year)$/)]);\n"),
("recurrence: "+E+".optional(),","recurrence: recurrenceSchema.optional(),"),
])
