# Round 3 (RPN-01) smoke: a double-click on Save is one save (1 dish, 1 entry, back to the planner).
AB="npx agent-browser --session dev-implementor"; F="form:has(input[name=name])"
P="$HOME/.openrig/workspace/specs/dausis-plate-team/bin/dev-stack.sh"
DAY=$(TZ=Africa/Nairobi date +%F)
q() { printf "%s\n" "$1" > /tmp/dip/q.sql; "$P" psql -tA -f /tmp/dip/q.sql 2>&1 | tail -1; }
count() { echo "dishes=$(q "select count(*) from dishes where name='Repro Stew';") entries=$(q "select count(*) from menu_entries e join dishes d on d.id=e.dish_id where d.name='Repro Stew';")"; }
"$P" psql -f /tmp/dip/clean.sql >/dev/null 2>&1
$AB set viewport 375 812 >/dev/null
$AB open "http://127.0.0.1:54321/dev/login?to=http://127.0.0.1:3020/dashboard" >/dev/null; $AB wait --load networkidle >/dev/null
$AB open "http://127.0.0.1:3020/dashboard/dishes/new?day=$DAY" >/dev/null; $AB wait --load networkidle >/dev/null
$AB fill 'input[name=name]' 'Repro Stew' >/dev/null; $AB fill 'input[name=price_kes]' '450' >/dev/null
$AB eval "document.querySelector('input[name=add_kind][value=day]').click()" >/dev/null
$AB eval "(()=>{const b=document.querySelector('$F button[type=submit]');b.click();b.click()})()" >/dev/null; sleep 5
echo "double-click: $($AB eval "location.pathname+location.search") $(count)"
"$P" psql -f /tmp/dip/clean.sql >/dev/null 2>&1
echo "left: $(count)"
