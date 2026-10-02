async (page) => {
  if (!page.url().startsWith('http://127.0.0.1:5198/')) throw Error('Fixture only');
  const control = async data => page.request.post('http://127.0.0.1:18991/__test/control',{data});
  await control({failSettings:false,failProbe:false});
  await page.getByRole('button',{name:'plus 添加连接',exact:true}).click();
  const d=page.getByRole('dialog',{name:'添加模型连接',exact:true});
  await d.getByRole('textbox',{name:'* API Key',exact:true}).fill('fixture-key');
  await d.getByRole('button',{name:'下一步：选择与检测',exact:true}).click();
  await d.getByRole('combobox',{name:'* 默认模型 ID',exact:true}).fill('fixture-model');
  await d.getByRole('button',{name:'保存连接并分配用途',exact:true}).click();
  const assign=page.getByRole('dialog',{name:'将连接用于…'});
  if (!(await assign.getByRole('checkbox',{name:'对话与工具助手',exact:true}).isDisabled())) throw Error('Incompatible assistant role enabled');
  await control({failSettings:true});
  await assign.getByRole('button',{name:'应用到所选用途',exact:true}).click();
  await assign.getByRole('alert').filter({hasText:'测试设置保存失败'}).waitFor();
  if (!(await assign.getByRole('checkbox',{name:'正文生成',exact:true}).isChecked())) throw Error('Selection lost');
  await control({failSettings:false});
  await assign.getByRole('button',{name:'应用到所选用途',exact:true}).click();
  await assign.waitFor({state:'hidden'});
  const s=await (await page.request.get('http://127.0.0.1:18991/__test/state')).json();
  if (!s.user.generation_use_custom || s.user.preferred_llm_model!=='fixture-model') throw Error('Assignment not saved');
  await page.getByRole('button',{name:'生成偏好',exact:true}).click();
  return 'PASS: connection wizard, protocol-aware role assignment, failure retains choice, successful assignment';
}
