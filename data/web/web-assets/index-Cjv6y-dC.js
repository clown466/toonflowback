import{d as C,l,b as c,y as S,p as h,g as o,s,m as B,v as _,E as p}from"./index-CwV0k4-3.js";/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var P={color:{type:String,default:""},content:{type:[String,Function]},count:{type:[String,Number,Function],default:0},default:{type:[String,Function]},dot:Boolean,maxCount:{type:Number,default:99},offset:{type:Array},shape:{type:String,default:"circle",validator:function(e){return["circle","round"].includes(e)}},showZero:Boolean,size:{type:String,default:"medium",validator:function(e){return["small","medium"].includes(e)}}};/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var T=C({name:"TBadge",inheritAttrs:!1,props:P,setup:function(e,d){var v=d.attrs,m=h(),N=B(),f=o(function(){var t=N("count");return Number.isNaN(Number(t))?t:(t=Number(e.count),t>e.maxCount?"".concat(e.maxCount,"+"):t)}),y=function(){if(!e.offset)return{};var u=_(e.offset,2),a=u[0],n=u[1];return a=Number.isNaN(Number(a))?a:"".concat(a,"px"),n=Number.isNaN(Number(n))?n:"".concat(n,"px"),{xOffset:a,yOffset:n}},g=l(),r=l("badge"),b=o(function(){return!e.showZero&&(f.value===0||f.value==="0")}),O=o(function(){return[s(s(s(s({},"".concat(r.value,"--dot"),!!e.dot),"".concat(r.value,"--circle"),!e.dot&&e.shape==="circle"),"".concat(r.value,"--round"),!e.dot&&e.shape==="round"),"".concat(g.value,"-size-s"),e.size==="small")]}),x=o(function(){var t=y(),u=t.xOffset,a=t.yOffset;return{background:e.color,right:u,top:a}});return function(){return c("div",S({class:r.value},v),[m("default","content"),b.value?null:c("sup",{class:O.value,style:x.value},[e.dot?null:f.value])])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var w=p(T);export{w as B};
