import {after,afterEach,test}from'node:test';
import assert from'node:assert/strict';
import {JSDOM}from'jsdom';
import React from'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:5173/#staff'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,MutationObserver:dom.window.MutationObserver,getComputedStyle:dom.window.getComputedStyle,FormData:dom.window.FormData,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
const {cleanup,fireEvent,render,screen,waitFor}=await import('@testing-library/react');
const {StaffPage}=await import('../src/staff-page.tsx');
afterEach(()=>{cleanup();globalThis.fetch=undefined;});after(()=>dom.window.close());
const person={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',firstName:'Ada',lastName:'Trainer',displayName:'Ada Trainer',email:null,phone:null,status:'active',baseRole:'trainer',operationalStartDate:'2026-10-01',calendarColor:null};
const response=(body,status=200)=>Promise.resolve({ok:status>=200&&status<300,status,json:async()=>body});
test('team dashboard renders loading, staff summary and keeps unlinked timeclock protected',async()=>{
 globalThis.fetch=async url=>{const path=new URL(String(url)).pathname;if(path==='/api/staff/dashboard')return response({timezone:'Atlantic/Canary',workingNow:[],todayScheduled:1,activeAbsences:[],upcomingSubstitutions:[],timeclockIncidents:0});if(path==='/api/staff')return response([person]);if(path==='/api/timeclock/self')return response({error:'staff_account_unlinked'},404);if(path===`/api/staff/${person.id}`)return response({professional:person,schedule:[],exceptions:[]});if(path===`/api/staff/${person.id}/history`)return response([{id:'event-1',action:'professional.created',occurredAt:'2026-10-01T09:00:00Z'}]);return response([]);};
 render(React.createElement(StaffPage));assert.ok(screen.getByRole('status'));await screen.findByText('En agenda hoy');assert.equal(screen.getByText('Ada Trainer').textContent,'Ada Trainer');fireEvent.click(screen.getByRole('button',{name:/Ada Trainer/}));await screen.findByText('Sin correo');fireEvent.click(screen.getByRole('tab',{name:'Historial'}));await screen.findByText('Profesional añadido');assert.ok(screen.getByText('Fichaje no disponible'));
});
test('add professional dialog has an accessible title and restores focus on close',async()=>{
 globalThis.fetch=async url=>{const path=new URL(String(url)).pathname;if(path==='/api/staff/dashboard')return response({timezone:'Atlantic/Canary',workingNow:[],todayScheduled:0,activeAbsences:[],upcomingSubstitutions:[],timeclockIncidents:0});if(path==='/api/staff')return response([]);return response({error:'staff_account_unlinked'},404);};
 render(React.createElement(StaffPage));const openers=await screen.findAllByRole('button',{name:'Añadir profesional'});const opener=openers[0];fireEvent.click(opener);const dialog=screen.getByRole('dialog',{name:'Añadir profesional'});assert.equal(document.activeElement,dialog.querySelector('input'));fireEvent.keyDown(document,{key:'Escape'});await waitFor(()=>assert.equal(document.activeElement,opener));
});
