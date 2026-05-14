import{d as P,T as F,U as H,I as J,c,a as o,b as n,a1 as V,f as i,w as l,e as m,J as B,a7 as T,ab as Z,$ as f,Z as I,a0 as $,z as v,g as G,o as r,_ as K}from"./index-DXS7sV1z.js";import{i as g}from"./axios-CJ9BA_kU.js";import{I as O}from"./index-B_YuZ8jP.js";import{I as Q}from"./index-CMxFlBN0.js";import{B as W}from"./index-4QgiPXjH.js";import{T as X}from"./index-CnxRH5pL.js";import{E as Y}from"./index-D1sinsPK.js";import{v as ee}from"./MdEditor-dOso8iDJ.js";import{D as te}from"./plugin-B5R79Vlx.js";import"./dialog-PoqBqSN3.js";import"./index-BETGohS9.js";import"./index-DzkKO6NI.js";import"./index3-BcPG5EUD.js";const ae={class:"imageGenerationSkill"},oe={class:"skillList"},se={class:"toolbar"},ie={class:"listBody"},ne=["onClick"],le={class:"itemTitle"},re={class:"itemMeta"},de={key:0,class:"itemDesc"},ue={class:"editorPanel"},ce={class:"editorHeader"},me={class:"fileControl"},ve={class:"actions"},pe={class:"editorBody"},fe={class:"variableBar"},_e=P({__name:"imageGenerationSkill",setup(ge){const{themeSetting:M}=F(H()),z=["bold","italic","strikeThrough","-","title","unorderedList","orderedList","quote","-","codeRow","code","table","-","revoke","next","=","preview"],D=["{{visualManual}}","{{project.name}}","{{project.artStyle}}","{{project.directorManual}}","{{asset.name}}","{{asset.describe}}","{{asset.prompt}}","{{userRequirement}}"],p=v([]),s=v(""),d=v(""),_=v(""),u=v(L("custom_image_skill")),k=v(!1),U=G(()=>M.value.mode==="dark"?"dark":"light"),j=G(()=>{const t=_.value.trim().toLowerCase();return t?p.value.filter(e=>[e.id,e.name,e.description,e.tags.join(",")].join(" ").toLowerCase().includes(t)):p.value});function N(t){return t==="role"?"角色":t==="scene"?"场景":t==="tool"?"道具":t}function L(t){return`---
id: ${t}
name: 自定义生图 Skill
description: 按指定资产场景改写生图提示词
targetTypes: role,scene,tool
tags: 自定义
aspectRatio: 16:9
---
你是 Toonflow 的资产生图提示词专家。

请根据视觉手册、项目设定和资产信息，生成一张可直接用于图像模型的资产设定图。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

资产：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 提示词：{{asset.prompt}}

用户额外要求：
{{userRequirement}}

输出要求：
- 保持同一项目美术风格
- 不要生成文字、水印、字幕、UI
- 画面清晰，适合作为后续生产参考图
`}async function w(t=!1){const{data:e}=await g.post("/setting/imageGenerationSkill/list");p.value=Array.isArray(e)?e:[],t&&!s.value&&p.value[0]&&await R(p.value[0].id)}async function R(t){const{data:e}=await g.post("/setting/imageGenerationSkill/get",{id:t});s.value=e.id,d.value=e.id,u.value=e.content||""}function y(){const t=`custom_image_skill_${Date.now()}`;s.value="",d.value=t,u.value=L(t)}async function q(){if(!d.value.trim()){window.$message.warning("请输入文件名");return}k.value=!0;try{const{data:t}=await g.post("/setting/imageGenerationSkill/save",{id:d.value,content:u.value});s.value=t.id,d.value=t.id,u.value=t.content||u.value,await w(),window.$message.success("保存成功")}catch(t){window.$message.error(t.message??"保存失败")}finally{k.value=!1}}function E(){if(!s.value)return;const t=te.confirm({header:"删除生图 Skill",body:`确认删除 ${s.value}.md？`,confirmBtn:"删除",cancelBtn:"取消",theme:"warning",onConfirm:async()=>{try{await g.post("/setting/imageGenerationSkill/delete",{id:s.value}),s.value="",y(),await w(),window.$message.success("删除成功")}catch(e){window.$message.error(e.message??"删除失败")}finally{t.destroy()}}})}return J(async()=>{await w(!0),s.value||y()}),(t,e)=>{const x=O,b=Q,h=W,S=X,A=Y;return r(),c("div",ae,[o("aside",oe,[o("div",se,[n(x,{modelValue:i(_),"onUpdate:modelValue":e[0]||(e[0]=a=>V(_)?_.value=a:null),clearable:"",placeholder:"搜索生图 Skill"},null,8,["modelValue"]),n(h,{theme:"primary",onClick:y},{icon:l(()=>[n(b,{name:"add"})]),default:l(()=>[e[3]||(e[3]=m(" 新建 ",-1))]),_:1})]),o("div",ie,[(r(!0),c(B,null,T(i(j),a=>(r(),c("div",{key:a.id,class:Z(["skillItem",{active:a.id===i(s)}]),onClick:C=>R(a.id)},[o("div",le,f(a.name),1),o("div",re,[(r(!0),c(B,null,T(a.targetTypes,C=>(r(),I(S,{key:C,size:"small",variant:"light-outline"},{default:l(()=>[m(f(N(C)),1)]),_:2},1024))),128)),a.aspectRatio?(r(),I(S,{key:0,size:"small",variant:"outline"},{default:l(()=>[m(f(a.aspectRatio),1)]),_:2},1024)):$("",!0)]),a.description?(r(),c("div",de,f(a.description),1)):$("",!0)],10,ne))),128)),i(j).length?$("",!0):(r(),I(A,{key:0,description:"暂无生图 Skill"}))])]),o("section",ue,[o("div",ce,[o("div",me,[e[4]||(e[4]=o("span",{class:"label"},"文件名",-1)),n(x,{modelValue:i(d),"onUpdate:modelValue":e[1]||(e[1]=a=>V(d)?d.value=a:null),disabled:!!i(s),placeholder:"custom_image_skill"},null,8,["modelValue","disabled"]),e[5]||(e[5]=o("span",{class:"suffix"},".md",-1))]),o("div",ve,[n(h,{theme:"danger",variant:"outline",disabled:!i(s),onClick:E},{icon:l(()=>[n(b,{name:"delete"})]),default:l(()=>[e[6]||(e[6]=m(" 删除 ",-1))]),_:1},8,["disabled"]),n(h,{theme:"primary",loading:i(k),onClick:q},{icon:l(()=>[n(b,{name:"save"})]),default:l(()=>[e[7]||(e[7]=m(" 保存 ",-1))]),_:1},8,["loading"])])]),o("div",pe,[n(i(ee),{modelValue:i(u),"onUpdate:modelValue":e[2]||(e[2]=a=>V(u)?u.value=a:null),theme:i(U),toolbars:z,footers:[],"preview-theme":"github","code-theme":"atom",style:{height:"100%"}},null,8,["modelValue","theme"])]),o("div",fe,[e[8]||(e[8]=o("span",{class:"variableLabel"},"变量",-1)),(r(),c(B,null,T(D,a=>n(S,{key:a,size:"small",variant:"light-outline"},{default:l(()=>[m(f(a),1)]),_:2},1024)),64))])])])}}}),Le=K(_e,[["__scopeId","data-v-327f060b"]]);export{Le as default};
