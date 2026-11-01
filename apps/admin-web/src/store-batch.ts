export type PasteVariant = { id:string; sku:string|null; productName:string; label:string };
export type ParsedStockLine = { variantId:string; quantity:number; line:number };
export function parseStockPaste(value:string, variants:PasteVariant[]) {
  const source=value.trim();if(!source)return {items:[] as ParsedStockLine[],errors:[] as string[]};
  const delimiter=source.split(/\r?\n/,1)[0]?.includes('\t')?'\t':',';
  const rows=source.split(/\r?\n/).filter(row=>row.trim());const first=rows[0]?.toLowerCase()??'';
  const hasHeader=/sku|producto|talla|variante|unidades|units/.test(first);const data=hasHeader?rows.slice(1):rows;
  const items:ParsedStockLine[]=[],errors:string[]=[];
  data.forEach((row,index)=>{const line=index+(hasHeader?2:1),cells=row.split(delimiter).map(cell=>cell.trim().replace(/^"|"$/g,''));let variant:PasteVariant|undefined;let amountText='';
    if(cells.length===2){variant=variants.find(item=>item.sku&&item.sku.toLowerCase()===cells[0]?.toLowerCase());if(!variant)variant=variants.find(item=>`${item.productName} ${item.label}`.toLowerCase()===cells[0]?.toLowerCase());amountText=cells[1]??'';}
    else if(cells.length>=3){variant=variants.find(item=>`${item.productName} ${item.label}`.toLowerCase()===`${cells[0]} ${cells[1]}`.toLowerCase());amountText=cells[2]??'';}
    const amount=Number(amountText);if(!variant){errors.push(`Línea ${line}: SKU o producto+talla no reconocido.`);return;}if(!Number.isInteger(amount)||amount===0){errors.push(`Línea ${line}: las unidades deben ser un entero distinto de cero.`);return;}if(items.some(item=>item.variantId===variant?.id)){errors.push(`Línea ${line}: variante duplicada en el lote.`);return;}items.push({variantId:variant.id,quantity:amount,line});
  });return {items,errors};
}
