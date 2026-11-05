"""Force an audit failure for the current QA member only; assert password/session changes roll back."""
from pathlib import Path
exec((Path(__file__).parent/'verify-easm-settings.py').read_text().split("if '--cleanup' in sys.argv:")[0])
f=json.loads(STATE.read_text());i=int(f['id']);m=client();login(m,f['username'],f['password']);candidate=secrets.token_hex(14)
sql(f"""CREATE FUNCTION easm_qa_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_id={i} AND NEW.action='profile.password_change' THEN RAISE EXCEPTION 'qa audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER easm_qa_reject BEFORE INSERT ON console_audit FOR EACH ROW EXECUTE FUNCTION easm_qa_reject();""")
try:
 call(m,'POST','/me/password',500,{'current':f['password'],'password':candidate})
 call(m,'GET','/me');login(client(),f['username'],f['password']);login(client(),f['username'],candidate,401)
 print('PASS audit failure rolls back password change and session deletion')
finally:
 sql('DROP TRIGGER easm_qa_reject ON console_audit; DROP FUNCTION easm_qa_reject();')
