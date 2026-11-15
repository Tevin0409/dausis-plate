set -u
AB="npx agent-browser --session dev-implementor"
P="$HOME/.openrig/workspace/specs/dausis-plate-team/bin/dev-stack.sh psql"
F="form:has(input[name=name])"
setv() { $AB eval "(()=>{const i=document.querySelector('$1');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'$2');i.dispatchEvent(new Event('input',{bubbles:true}));return i.value})()" >/dev/null; }
status() { $AB eval "document.querySelector('$F [role=status]').innerText.split('\n')[0] + ' | new_id=' + document.querySelector('input[name=new_id]').value + ' | inline=' + ([...document.querySelectorAll('$F [role=alert]')].map(a=>a.textContent).join(' / ')) + ' | focus=' + (document.activeElement.name||document.activeElement.getAttribute('role'))"; }
count() { $P -At -c "select count(*)||' dishes, '||(select count(*) from menu_entries e join dishes d on d.id=e.dish_id where d.name='Repro Stew')||' entries' from dishes where name='Repro Stew';" 2>&1 | tail -1; }
$AB set viewport 1280 900 >/dev/null
$AB open "http://127.0.0.1:3020/dashboard/dishes/new?day=2026-11-15" >/dev/null; $AB wait --load networkidle >/dev/null
$AB eval "location.pathname" 
$AB fill 'input[name=name]' 'Repro Stew' >/dev/null; $AB fill 'input[name=price_kes]' '450' >/dev/null
echo "== A. Tevin's steps: everyday on, Rest of the week, 12:00, no plates"
$AB eval "document.querySelector('[data-everyday] [role=switch]').click()" >/dev/null
$AB eval "document.querySelector('input[name=add_kind][value=week]').click()" >/dev/null
setv 'input[name=show_from]' '12:00'
for i in 1 2 3; do $AB eval "document.querySelector('$F button[type=submit]').click()" >/dev/null; sleep 1.5; done
status; count
$AB screenshot /tmp/dip/a-everyday-1280.png >/dev/null
echo "== B. everyday off, until before from"
$AB eval "document.querySelector('[data-everyday] [role=switch]').click()" >/dev/null
setv 'input[name=show_until]' '10:00'
$AB eval "document.querySelector('$F button[type=submit]').click()" >/dev/null; sleep 1.5
status; count
$AB screenshot /tmp/dip/b-hours-1280.png >/dev/null
echo "== C. refusal after the dish saved (Sunday closed meanwhile), then retry"
setv 'input[name=show_until]' '20:00'
$AB eval "document.querySelector('input[name=add_kind][value=day]').click()" >/dev/null
$P -c "update opening_hours set is_open=false where weekday=0;" >/dev/null 2>&1
$AB eval "document.querySelector('$F button[type=submit]').click()" >/dev/null; sleep 4
status; count
$AB screenshot /tmp/dip/c-saved-not-planned-1280.png >/dev/null
$P -c "update opening_hours set is_open=true where weekday=0;" >/dev/null 2>&1
$AB eval "document.querySelector('$F button[type=submit]').click()" >/dev/null; sleep 5
$AB eval "location.pathname + location.search"; count
