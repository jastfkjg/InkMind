#!/usr/bin/env bash
set -euo pipefail
backend=${1:?Set backend image}
frontend=${2:?Set frontend image}
revision=${3:?Set revision}
project="inkmind-smoke-${GITHUB_RUN_ID:-local}-${RANDOM}"
temporary=$(mktemp -d)
cleanup() {
    docker compose --project-name "$project" -f "$temporary/compose.json" down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$temporary"
}
trap cleanup EXIT
python3 - "$temporary/compose.json" "$backend" "$frontend" <<'PY'
import json, secrets, sys
spec={'services': {
 'backend': {'image':sys.argv[2], 'environment':{'SECRET_KEY':secrets.token_urlsafe(48),'DATABASE_URL':'sqlite:////app/data/inkmind.db'},
             'healthcheck':{'test':['CMD','curl','-fsS','http://localhost:8000/health'],'interval':'2s','retries':60}},
 'frontend':{'image':sys.argv[3],'depends_on':{'backend':{'condition':'service_healthy'}},'ports':['127.0.0.1::80'],
             'healthcheck':{'test':['CMD','wget','-q','-O','/dev/null','http://localhost/frontend-health'],'interval':'2s','retries':60}}}}
open(sys.argv[1],'w').write(json.dumps(spec))
PY
compose() { docker compose --project-name "$project" -f "$temporary/compose.json" "$@"; }
compose up -d --wait --wait-timeout 180
port=$(compose port frontend 80)
python3 - "$port" "$revision" <<'PY'
import json, secrets, sys, urllib.request
origin='http://'+sys.argv[1]
for path, service in [('health','inkmind'),('api/health','inkmind'),('frontend-health','inkmind-frontend')]:
    with urllib.request.urlopen(origin+'/'+path) as response: data=json.load(response)
    assert data['status']=='ok' and data['service']==service and data['revision']==sys.argv[2], data
for path in ['/', '/novels/1/write']:
    with urllib.request.urlopen(origin+path) as response: assert b'<div id="root">' in response.read()
with urllib.request.urlopen(origin+'/api/meta/llm-providers') as response: assert response.status==200

def request(path, body=None, token=None, method=None):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    req=urllib.request.Request(origin+'/api/'+path, data=json.dumps(body).encode() if body is not None else None,
                               headers=headers, method=method)
    with urllib.request.urlopen(req) as response: return json.load(response)

session=request('auth/register', {'email':'smoke@example.com','password':secrets.token_urlsafe(24),'display_name':'发布检查'})
token=session['access_token']
novel=request('novels', {'title':'部署检查作品'}, token)
chapter_path='novels/'+str(novel['id'])+'/chapters'
chapter=request(chapter_path, {'title':'第一章','content':'原稿内容'}, token)
request(chapter_path+'/'+str(chapter['id']), {'content':'保存后的中文正文'}, token, 'PATCH')
assert request(chapter_path+'/'+str(chapter['id']), token=token)['content']=='保存后的中文正文'
assert request('novels', token=token)[0]['title']=='部署检查作品'
PY
