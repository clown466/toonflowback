import{d as h,l as y,s as n,b as o,p as g,g as r,bX as c,E as p}from"./index-CcWaFW2J.js";/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var m={align:{type:String,default:"center",validator:function(t){return t?["left","right","center"].includes(t):!0}},content:{type:[String,Function]},dashed:Boolean,default:{type:[String,Function]},layout:{type:String,default:"horizontal",validator:function(t){return t?["horizontal","vertical"].includes(t):!0}},size:{type:[String,Number]}};/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var x=h({name:"TDivider",props:m,setup:function(t){var e=y("divider"),v=g();return function(){var u=v("default","content"),l=r(function(){return t.layout!=="vertical"}),a=r(function(){return l.value&&!!u}),d=["".concat(e.value),["".concat(e.value,"--").concat(t.layout)],n(n(n({},"".concat(e.value,"--dashed"),!!t.dashed),"".concat(e.value,"--with-text"),!!a.value),"".concat(e.value,"--with-text-").concat(t.align),!!a.value)],s=r(function(){if(t.size){var f=l.value?"".concat(c(t.size)," 0"):"0 ".concat(c(t.size));return{margin:f}}return null});return o("div",{class:d,style:s.value},[a.value&&o("span",{class:"".concat(e.value,"__inner-text")},[u])])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var C=p(x);export{C as D};
