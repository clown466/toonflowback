import{d as x,l as k,aL as p,h as _,aK as N,b as l,av as T,p as I,m as b,g as w,s as i,E as P}from"./index-B5XwyaQc.js";/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var E={content:{type:[String,Function]},default:{type:[String,Function]},disabled:{type:Boolean,default:void 0},download:{type:[String,Boolean]},hover:{type:String,default:"underline",validator:function(e){return e?["color","underline"].includes(e):!0}},href:{type:String,default:""},prefixIcon:{type:Function},size:{type:String,default:"medium",validator:function(e){return e?["small","medium","large"].includes(e):!0}},suffixIcon:{type:Function},target:{type:String,default:""},theme:{type:String,default:"default",validator:function(e){return e?["default","primary","danger","warning","success"].includes(e):!0}},underline:Boolean,onClick:Function};/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var F=x({name:"TLink",props:E,emits:["click"],setup:function(e,d){var f=d.emit,v=I(),u=b(),n=k("link"),o=p(),m=o.STATUS,g=o.SIZE,C=_("classPrefix"),S=C.classPrefix,a=N(),h=w(function(){return["".concat(n.value),"".concat(n.value,"--theme-").concat(e.theme),i(i(i(i({},g.value[e.size],e.size!=="medium"),m.value.disabled,a.value),"".concat(S.value,"-is-underline"),e.underline),"".concat(n.value,"--hover-").concat(e.hover),!a.value)]}),y=function(t){a.value||f("click",t)};return function(){var s=v("default","content"),t=u("prefixIcon"),c=u("suffixIcon");return l("a",{class:T(h.value),href:a.value||!e.href?void 0:e.href,target:e.target?e.target:void 0,download:e.download?e.download:void 0,onClick:y},[t?l("span",{class:"".concat(n.value,"__prefix-icon")},[t]):null,s,c?l("span",{class:"".concat(n.value,"__suffix-icon")},[c]):null])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var A=P(F);export{A as L};
