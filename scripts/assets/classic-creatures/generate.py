"""Original Classic cuboid creatures. Run with Blender --background --python this.py -- --output-dir DIR.
Coordinates in recipes are x/right, y/up, z/forward in sixteenth-block units.
Each articulated cuboid has an explicit pivot; Blender creates geometry/UV/materials,
then the same recipe adds deterministic glTF transform clips (no skin/root motion).
"""
import argparse, hashlib, json, math, struct, sys
from pathlib import Path
import bpy

KINDS = ['pig','cow','sheep','chicken','squid','wolf','zombie','skeleton','spider','creeper','slime','pig-zombie']
COLORS = {
 'pig': [(190,126,126),(221,160,155),(141,86,82)], 'cow': [(85,72,59),(211,206,184),(49,46,40)],
 'sheep': [(218,215,199),(172,157,133),(94,83,68)], 'chicken': [(217,219,203),(183,143,50),(154,58,45)],
 'squid': [(42,74,93),(70,106,124),(24,46,62)], 'wolf': [(175,178,169),(221,213,189),(81,83,78)],
 'zombie': [(100,133,80),(55,135,137),(78,73,118)], 'skeleton': [(194,194,175),(147,148,135),(76,71,56)],
 'spider': [(62,53,46),(90,74,59),(174,45,32)], 'creeper': [(98,137,64),(134,165,91),(52,78,36)],
 'slime': [(110,166,77),(140,192,102),(58,110,47)], 'pig-zombie': [(180,124,113),(106,137,75),(109,76,49)],
}

def part(name, center, size, tile=0, pivot=None, motion=None, parent=None):
 return dict(name=name,center=center,size=size,tile=tile,pivot=pivot or center,motion=motion,parent=parent)

def recipe(kind):
 p=[]
 def add(name,c,s,t=0,pivot=None,motion=None,parent=None): p.append(part(name,c,s,t,pivot,motion,parent))
 def legs(xs, zs, top, length, width=3):
  for xi,x in enumerate(xs):
   for zi,z in enumerate(zs): add(f'leg-{xi}-{zi}',(x,top-length/2,z),(width,length,width),2,(x,top,z),('leg',1 if (xi+zi)%2 else -1))
 if kind in ['pig','cow','sheep','wolf']:
  if kind=='pig': body=(10,8,15); by=9; head=(8,8,7); hy=10; hz=9; top=6; length=6
  elif kind=='cow': body=(10,12,16); by=14; head=(8,9,7); hy=17; hz=10; top=10; length=10
  elif kind=='sheep': body=(12,11,17); by=12; head=(7,7,7); hy=13; hz=11; top=8; length=8
  else: body=(7,7,13); by=9; head=(6,6,6); hy=11; hz=9; top=7; length=7
  add('body',(0,by,0),body)
  add('head',(0,hy,hz),head,1,(0,hy,hz-2),('head',1))
  if kind in ['pig','cow','wolf']: add('muzzle',(0,hy-2,hz+head[2]/2+1),(4 if kind!='wolf' else 4,3,2 if kind!='wolf' else 4),3,parent='head')
  legs([-body[0]/2+2,body[0]/2-2],[-5,5],top,length)
  if kind in ['cow','wolf']:
   for x in [-3,3]: add('horn' if x<0 else 'horn-right',(x,hy+head[1]/2+1,hz-1),(2,3,2),4,parent='head')
  if kind=='pig': add('tail',(0,by+1,-8),(2,2,2),3,(0,by+1,-7),('tail',1))
  if kind=='wolf': add('tail',(0,10,-9),(2,2,7),0,(0,10,-6),('tail',1))
  if kind=='cow': add('udder',(0,8,-3),(5,3,5),3)
 elif kind=='chicken':
  add('body',(0,7,0),(6,6,8)); add('head',(0,12,5),(5,6,5),1,(0,10,4),('head',1))
  add('beak',(0,11,8),(4,2,3),3,parent='head'); add('wattle',(0,9,7),(2,3,1),4,parent='head')
  legs([-2,2],[0],4,4,1)
  for sign in [-1,1]:
   add(f'wing-{sign}',(sign*4,7,0),(2,5,6),0,(sign*3,10,0),('wing',sign))
   add(f'foot-{sign}',(sign*2,.5,1),(3,1,3),3,parent=f'leg-{0 if sign<0 else 1}-0')
 elif kind=='squid':
  add('body',(0,13,0),(10,12,10),1)
  for i in range(8):
   a=i*math.pi/4; x,z=math.cos(a)*4,math.sin(a)*4
   add(f'tentacle-{i}',(x*1.35,3.5,z*1.35),(2,8,2),0,(x,7,z),('tentacle',i))
   p[-1]['longAxis']=[x*.7,-7,z*.7]; p[-1]['alignAxis']=[0,1,0]
 elif kind in ['zombie','skeleton','pig-zombie']:
  skeleton=kind=='skeleton'; width=2 if skeleton else 4
  add('body',(0,18,0),(2 if skeleton else 8,10 if skeleton else 12,2 if skeleton else 4),0 if skeleton else 4)
  add('head',(0,28,0),(8,8,8),1,(0,24,0),('head',1))
  for sign in [-1,1]:
   add(f'leg-{sign}',(sign*2,6,0),(width,12,width),2,(sign*2,12,0),('leg',sign))
   add(f'arm-{sign}',(sign*6,23,5) if kind=='zombie' else (sign*6,19,0),(width,width,12) if kind=='zombie' else (width,12,width),0,(sign*6,24,0),('arm',sign))
  if skeleton:
   # +Z is the face/shooting direction. The grip is forward of both tips;
   # the string connects the tips on the body side of the stave.
   arm=next(q for q in p if q['name']=='arm--1')
   arm.update(center=(-6,18.5,2),size=(2,math.hypot(11,4),2),longAxis=[0,-11,4],alignAxis=[0,1,0])
   for y in [15,18,21]: add(f'rib-{y}',(0,y,2),(8,1,1),0)
   add('spine',(0,17,-1),(2,12,2),0)
   grip=(-6,13,4); upper_knee=(-6,17.5,3.5); lower_knee=(-6,8.5,3.5)
   upper_tip=(-6,20,2); lower_tip=(-6,6,2)
   add('hand-bow',grip,(2.4,2,2.4),0,parent='arm--1')
   add('bow-grip',grip,(1,3,1),3,grip,('bow',-1),'arm--1')
   for name,start,end in [('bow-upper-inner',grip,upper_knee),('bow-upper-outer',upper_knee,upper_tip),('bow-lower-inner',grip,lower_knee),('bow-lower-outer',lower_knee,lower_tip),('bow-string',lower_tip,upper_tip)]:
    axis=[end[k]-start[k] for k in range(3)]; length=math.sqrt(sum(v*v for v in axis)); width=.25 if name=='bow-string' else 1.2
    add(name,tuple((start[k]+end[k])/2 for k in range(3)),(width,length,width),0 if name=='bow-string' else 3,parent='bow-grip')
    p[-1].update(longAxis=axis,alignAxis=[0,1,0],ends=[start,end])
  if kind=='pig-zombie':
   add('snout',(0,26,5),(4,3,2),3,parent='head')
   add('gold-sword',(-6,23,5),(2,12,1),5,parent='arm--1'); add('sword-guard',(-6,18,5),(5,1,2),5,parent='arm--1')
 elif kind=='spider':
  add('abdomen',(0,6,-5),(11,8,12)); add('thorax',(0,5,3),(7,6,6)); add('head',(0,5,8),(8,6,6),1,(0,5,5),('head',1))
  for side in [-1,1]:
   for i in range(4):
    z=-4+i*3; spread=(i-1.5)*2.3
    a=(side*3,5,z); b=(side*9,5.5,z+spread); c=(side*14,1,z+spread*1.7)
    for segment,(start,end) in enumerate([(a,b),(b,c)]):
     axis=[end[k]-start[k] for k in range(3)]; length=math.sqrt(sum(v*v for v in axis))
     name=f'leg-{side}-{i}' if segment==0 else f'leg-tip-{side}-{i}'
     add(name,tuple((start[k]+end[k])/2 for k in range(3)),(length,2,2),0,start,('spider',side*(i+1)) if segment==0 else None,f'leg-{side}-{i}' if segment else None)
     p[-1]['longAxis']=axis; p[-1]['alignAxis']=[1,0,0]
 elif kind=='creeper':
  add('body',(0,14,0),(8,12,5)); add('head',(0,24,0),(8,8,8),1,(0,20,0),('head',1)); legs([-3,3],[-3,3],8,8,4)
 elif kind=='slime':
  add('body',(0,8,0),(16,16,16),6,(0,0,0),('gel',1)); add('core',(0,7,0),(11,11,11),1,(0,0,0),('gel',1))
  for sign in [-1,1]: add(f'eye-{sign}',(sign*3,9,6),(2,3,1),2,parent='core')
  add('mouth',(0,5,6),(2,1,1),2,parent='core')
 return p

def color_at(kind,tile,x,y):
 base, accent, dark=COLORS[kind]
 c=base
 if tile==2: c=dark if kind not in ['pig','sheep','wolf','chicken','skeleton','pig-zombie'] else base
 if tile==3: c=accent
 if tile==4: c=accent
 if tile==5: c=(185,164,68)
 if kind=='skeleton' and tile==3: c=(108,80,43)
 if kind=='pig-zombie' and tile==4: c=(119,88,61)
 if kind=='cow' and tile in [0,1,2] and ((x//4+2*(y//5))%5<2): c=accent
 if kind=='sheep' and tile==1: c=accent
 if kind=='chicken' and tile==4: c=dark
 if kind=='pig-zombie' and tile in [0,1,2] and ((x//3+y//4)%4==0): c=accent
 if kind=='zombie' and tile==2: c=dark
 if kind=='creeper' and (x//2+y//3)%3==0: c=accent
 # Low-frequency restrained blocks, deterministic and never white noise.
 shade = [0,0,0,5,-6][((x//3)*3+(y//4)*7+tile)%5]
 c=tuple(max(0,min(255,a+shade)) for a in c)
 if tile==1:
  if (3<=x<=5 or 10<=x<=12) and 8<=y<=10: c=(27,29,25) if kind!='spider' else (172,41,29)
  if kind in ['pig','cow','sheep','wolf','chicken'] and (x in [3,12]) and y==10: c=(229,224,202)
  if kind in ['skeleton','creeper'] and 5<=x<=10 and 3<=y<=5: c=(33,38,28)
  if kind=='creeper' and 7<=x<=8 and 5<=y<=8: c=(33,38,28)
 if tile==3 and kind in ['pig','cow','pig-zombie'] and x in [4,5,10,11] and 6<=y<=8: c=dark
 return (*c, 125 if tile==6 else 255)

def atlas(kind,out):
 im=bpy.data.images.new(kind+'-pixels',width=64,height=64,alpha=True)
 pixels=[]
 for y in range(64):
  for x in range(64): pixels.extend(v/255 for v in color_at(kind,(y//16)*4+x//16,x%16,y%16))
 im.pixels=pixels; im.filepath_raw=str(out/(kind+'.png')); im.file_format='PNG'; im.save(); im.pack()
 mat=bpy.data.materials.new(kind+'-pixel'); mat.use_nodes=True
 nodes=mat.node_tree.nodes; bs=nodes.get('Principled BSDF'); bs.inputs['Roughness'].default_value=1
 tex=nodes.new('ShaderNodeTexImage'); tex.image=im; tex.interpolation='Closest'
 mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
 return mat

def vec(v): return (v[0]/16,-v[2]/16,v[1]/16)
def make_mesh(p, root, mat, objects):
 pivot=bpy.data.objects.new(p['name'],None); bpy.context.collection.objects.link(pivot)
 pivot.parent=objects.get(p['parent'],root)
 parentcenter=next((q['pivot'] for q in CURRENT if q['name']==p['parent']),[0,0,0])
 pivot.location=vec([p['pivot'][a]-parentcenter[a] for a in range(3)])
 cx,cy,cz=[p['center'][a]-p['pivot'][a] for a in range(3)]; sx,sy,sz=p['size']
 corners=[(cx+sx*x/2,cy+sy*y/2,cz+sz*z/2) for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
 if 'longAxis' in p:
  from mathutils import Vector
  rotation=Vector(p['alignAxis']).rotation_difference(Vector(p['longAxis']).normalized())
  corners=[tuple(rotation @ Vector((v[0]-cx,v[1]-cy,v[2]-cz)) + Vector((cx,cy,cz))) for v in corners]
 faces=[(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(3,7,6,2),(0,1,5,4)]
 mesh=bpy.data.meshes.new(p['name']+'-mesh'); mesh.from_pydata([vec(v) for v in corners],[],faces); mesh.update()
 obj=bpy.data.objects.new(p['name']+'-surface',mesh); bpy.context.collection.objects.link(obj); obj.parent=pivot
 if p['tile']==6:
  shell=mat.copy(); shell.name='slime-shell'; shell.surface_render_method='DITHERED'
  bs=shell.node_tree.nodes.get('Principled BSDF'); tex=next(n for n in shell.node_tree.nodes if n.type=='TEX_IMAGE'); shell.node_tree.links.new(tex.outputs['Alpha'],bs.inputs['Alpha']); mesh.materials.append(shell)
 else: mesh.materials.append(mat)
 uv=mesh.uv_layers.new(name='UVMap')
 for poly in mesh.polygons:
  tile=p['tile'] if poly.index==1 or p['tile']!=1 else 0
  tx,ty=tile%4,tile//4
  for li, xy in zip(poly.loop_indices,[(0,0),(1,0),(1,1),(0,1)]): uv.data[li].uv=((tx*16+.05+xy[0]*15.9)/64,(ty*16+.05+xy[1]*15.9)/64)
 objects[p['name']]=pivot

# Add compact clips to exported GLB. Local glTF axes: x/right, y/up, z/forward.
def add_clips(path,kind,parts):
 data=path.read_bytes(); n=struct.unpack_from('<I',data,12)[0]; doc=json.loads(data[20:20+n]); binary=bytearray(data[28+n:]); nodeids={node.get('name'):i for i,node in enumerate(doc['nodes'])}
 def accessor(values,typ):
  while len(binary)%4: binary.append(0)
  off=len(binary); flat=[v for row in values for v in (row if isinstance(row,tuple) else (row,))]; binary.extend(struct.pack('<'+'f'*len(flat),*flat))
  vi=len(doc['bufferViews']); doc['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':len(flat)*4})
  ai=len(doc['accessors']); a={'bufferView':vi,'componentType':5126,'count':len(values),'type':typ}
  if typ=='SCALAR': a.update(min=[min(values)],max=[max(values)])
  doc['accessors'].append(a); return ai
 doc['animations']=[]
 for role,duration in [('idle',2),('move',.8 if kind not in ['slime','squid'] else 1.2),('attack',.8),('hurt',.35)]:
  times=[0,.25,.5,.75,1]; ti=accessor([t*duration for t in times],'SCALAR'); anim={'name':role,'samplers':[],'channels':[]}
  def channel(name,path,values,typ):
   oi=accessor(values,typ); si=len(anim['samplers']); anim['samplers'].append({'input':ti,'output':oi,'interpolation':'LINEAR'}); anim['channels'].append({'sampler':si,'target':{'node':nodeids[name],'path':path}})
  for p in parts:
   if not p['motion']: continue
   mode,sign=p['motion']; values=[]
   for t in times:
    wave=math.sin(2*math.pi*t); angle=0; axis=0
    if mode=='gel':
     k=(.13*wave if role=='move' else .025*wave if role=='idle' else .18*math.sin(math.pi*t)); values.append((1-k/2,1+k,1-k/2)); continue
    if role=='move':
     angle=wave*.6*(1 if sign>0 else -1)
     if mode=='head': angle=wave*.055; axis=1
     if mode=='tail': angle=wave*.35; axis=1
     if mode=='wing': angle=wave*.65*sign; axis=2
     if mode=='tentacle': angle=.24+math.sin(2*math.pi*t+sign*.7)*.28; axis=0 if sign%2 else 2
     if mode=='spider': angle=wave*.32*(1 if sign>0 else -1); axis=1
    elif role=='idle':
     angle=wave*(.055 if mode in ['head','tail','wing','tentacle'] else .008); axis=1 if mode in ['head','tail'] else 0
    elif role=='attack':
     angle=math.sin(math.pi*t)*(-.95 if mode=='arm' else .3 if mode=='head' else .12*(1 if sign>0 else -1))
    elif role=='hurt': angle=math.sin(math.pi*t)*.22; axis=2
    if kind=='skeleton' and mode in ['arm','bow']:
     # Shoulder raises the hand; the grip counter-rotates at that same hand
     # attachment to keep the bow vertical, including at the attack apex.
     if role=='attack':
      lift=[0,.9,1,.7,0][times.index(t)]
      angle=-(math.atan2(11,4) if sign<0 else 1.05)*lift
     elif role=='move': angle=wave*.16*(1 if sign>0 else -1)
     elif role=='idle': angle=wave*.015
     if mode=='bow': angle=-angle
    q=[0.,0.,0.,math.cos(angle/2)]; q[axis]=math.sin(angle/2); values.append(tuple(q))
   channel(p['name'],'scale' if mode=='gel' else 'rotation',values,'VEC3' if mode=='gel' else 'VEC4')
  doc['animations'].append(anim)
 # No floating clock metadata. Nearest sampler is explicit on every texture.
 for sampler in doc.get('samplers',[]): sampler.update(magFilter=9728,minFilter=9728)
 doc['buffers'][0]['byteLength']=len(binary)
 while len(binary)%4: binary.append(0)
 js=json.dumps(doc,separators=(',',':')).encode(); js+=b' '*((-len(js))%4)
 path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(js)+len(binary))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(binary),b'BIN\0')+binary)
 return doc

parser=argparse.ArgumentParser(); parser.add_argument('--output-dir',type=Path,required=True); parser.add_argument('--only',choices=KINDS); parser.add_argument('--render-dir',type=Path)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []); args.output_dir.mkdir(parents=True,exist_ok=True)
manifest={'schemaVersion':1,'recipeVersion':1,'license':'Apache-2.0','provenance':'Original Seedlands geometry, UV pixels and clips; no third-party source assets','blenderVersion':bpy.app.version_string,'recipeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'models':[]}
for kind in ([args.only] if args.only else KINDS):
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
 CURRENT=recipe(kind); root=bpy.data.objects.new(kind+'-root',None); bpy.context.collection.objects.link(root); mat=atlas(kind,args.output_dir); objects={}
 for p in CURRENT: make_mesh(p,root,mat,objects)
 path=args.output_dir/(kind+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=False)
 doc=add_clips(path,kind,CURRENT)
 manifest['models'].append({'kind':kind,'byteLength':path.stat().st_size,'nodeCount':len(doc['nodes']),'triangleCount':len(CURRENT)*12,'height':max(p['center'][1]+p['size'][1]/2 for p in CURRENT)/16,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'textureSha256':hashlib.sha256((args.output_dir/(kind+'.png')).read_bytes()).hexdigest(),'parts':CURRENT,'clips':['idle','move','attack','hurt']})
 print('CLASSIC_ASSET',kind,path.stat().st_size)
 if args.render_dir:
  from mathutils import Vector
  args.render_dir.mkdir(parents=True,exist_ok=True)
  scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=16
  scene.world.color=(.45,.45,.45); scene.render.resolution_x=512; scene.render.resolution_y=512; scene.render.resolution_percentage=100
  scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=True
  camera_data=bpy.data.cameras.new('Preview camera'); camera=bpy.data.objects.new('Preview camera',camera_data); scene.collection.objects.link(camera)
  height=manifest['models'][-1]['height']; camera.location=(3,-4,2.5); target=Vector((0,0,height*.5)); camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler(); camera_data.type='ORTHO'; camera_data.ortho_scale=max(2.4,height*1.4); scene.camera=camera
  light_data=bpy.data.lights.new('Preview light','AREA'); light_data.energy=400; light_data.size=4; light=bpy.data.objects.new('Preview light',light_data); scene.collection.objects.link(light); light.location=(-3,-4,6)
  scene.render.filepath=str(args.render_dir/(kind+'-preview.png')); bpy.ops.render.render(write_still=True)

(args.output_dir/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
