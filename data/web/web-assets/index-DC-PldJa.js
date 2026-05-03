import{d as z,l as N,s as c,b as u,g,J as w,m as x,d6 as C,d7 as F,d8 as E,Y as T,N as m,V as p,v as k,E as A}from"./index-CcWaFW2J.js";/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var D={align:{type:String,validator:function(e){return e?["start","end","center","baseline"].includes(e):!0}},breakLine:Boolean,direction:{type:String,default:"horizontal",validator:function(e){return e?["vertical","horizontal"].includes(e):!0}},separator:{type:[String,Function]},size:{type:[String,Number,Array],default:"medium"}};/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */function y(t,e){var a=Object.keys(t);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(t);e&&(r=r.filter(function(d){return Object.getOwnPropertyDescriptor(t,d).enumerable})),a.push.apply(a,r)}return a}function b(t){for(var e=1;e<arguments.length;e++){var a=arguments[e]!=null?arguments[e]:{};e%2?y(Object(a),!0).forEach(function(r){c(t,r,a[r])}):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(a)):y(Object(a)).forEach(function(r){Object.defineProperty(t,r,Object.getOwnPropertyDescriptor(a,r))})}return t}var O={small:"8px",medium:"16px",large:"24px"},_=E(),J=z({name:"TSpace",props:b(b({},D),{},{forceFlexGapPolyfill:Boolean}),setup:function(e){var a=N("space"),r=x(),d=C(),S=F(),v=g(function(){return e.forceFlexGapPolyfill||_}),P=g(function(){var n="";T(e.size)?n=e.size.map(function(l){return m(l)?"".concat(l,"px"):p(l)&&["small","medium","large"].includes(l)?O[l]:l}).join(" "):p(e.size)?n=["small","medium","large"].includes(e.size)?O[e.size]:e.size:m(e.size)&&(n="".concat(e.size,"px"));var i={};if(v.value){var f=n.split(" "),o=k(f,2),s=o[0],j=o[1];i["--td-space-column-gap"]=s,i["--td-space-row-gap"]=j||s}else i.gap=n;return i});function h(){var n=S(d()),i=r("separator");return n.map(function(f,o){var s=o+1!==n.length&&i;return u(w,null,[u("div",{class:"".concat(a.value,"-item")},[f]),s&&u("div",{class:"".concat(a.value,"-item-separator")},[i])])})}return function(){var n=["".concat(a.value),c(c(c(c({},"".concat(a.value,"-align-").concat(e.align),e.align),"".concat(a.value,"-").concat(e.direction),e.direction),"".concat(a.value,"--break-line"),e.breakLine),"".concat(a.value,"--polyfill"),v.value)];return u("div",{class:n,style:P.value},[h()])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var B=A(J);export{B as S};
