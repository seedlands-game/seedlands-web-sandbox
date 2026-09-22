"""Render actual exported skeleton GLB at idle/attack keys, from front and side.
Usage: blender --background --factory-startup --python <this-file> -- --model FILE --output-dir DIR
No source scene shortcuts: geometry, hierarchy and keyed transforms come from the GLB.
"""
import argparse, json, struct, sys
from pathlib import Path
import bpy
from mathutils import Quaternion, Vector

parser=argparse.ArgumentParser(); parser.add_argument('--model',type=Path,required=True); parser.add_argument('--output-dir',type=Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]); args.output_dir.mkdir(parents=True,exist_ok=True)
data=args.model.read_bytes(); json_length=struct.unpack_from('<I',data,12)[0]; document=json.loads(data[20:20+json_length]); binary_start=28+json_length
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(args.model))
objects={node['name']:bpy.data.objects.get(node['name']) for node in document['nodes']}
for obj in objects.values():
 if obj: obj.animation_data_clear()
def value(accessor_id,key):
 accessor=document['accessors'][accessor_id]; view=document['bufferViews'][accessor['bufferView']]; size={'VEC4':4,'VEC3':3}[accessor['type']]
 offset=binary_start+view.get('byteOffset',0)+accessor.get('byteOffset',0)+key*size*4
 return struct.unpack_from('<'+'f'*size,data,offset)
def pose(role,key):
 for node in document['nodes']:
  obj=objects[node['name']]
  if not obj: continue
  t=node.get('translation',[0,0,0]); q=node.get('rotation',[0,0,0,1]); s=node.get('scale',[1,1,1])
  obj.location=(t[0],-t[2],t[1]); obj.rotation_mode='QUATERNION'; obj.rotation_quaternion=Quaternion((q[3],q[0],-q[2],q[1])); obj.scale=(s[0],s[2],s[1])
 animation=next(a for a in document['animations'] if a['name']==role)
 for channel in animation['channels']:
  obj=objects[document['nodes'][channel['target']['node']]['name']]; sample=value(animation['samplers'][channel['sampler']]['output'],key)
  if channel['target']['path']=='rotation': obj.rotation_quaternion=Quaternion((sample[3],sample[0],-sample[2],sample[1]))
  elif channel['target']['path']=='scale': obj.scale=(sample[0],sample[2],sample[1])
  elif channel['target']['path']=='translation': obj.location=(sample[0],-sample[2],sample[1])
 bpy.context.view_layer.update()
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=32
scene.render.resolution_x=768; scene.render.resolution_y=768; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False; scene.view_settings.view_transform='Standard'
scene.world.use_nodes=True; background=scene.world.node_tree.nodes.get('Background'); background.inputs['Color'].default_value=(.8,.8,.8,1); background.inputs['Strength'].default_value=.65
camera_data=bpy.data.cameras.new('Evidence camera'); camera=bpy.data.objects.new('Evidence camera',camera_data); scene.collection.objects.link(camera); scene.camera=camera; camera_data.type='ORTHO'; camera_data.ortho_scale=2.65
light_data=bpy.data.lights.new('Evidence key','AREA'); light_data.energy=180; light_data.size=4; light=bpy.data.objects.new('Evidence key',light_data); scene.collection.objects.link(light); light.location=(-3,-4,5)
for role,key in [('idle',1),('attack',2)]:
 pose(role,key)
 for view,location in [('front',(0,-5,1)),('side',(5,0,1)),('three-quarter',(3,-4,2.5))]:
  camera.location=location; target=Vector((0,0,1)); camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
  scene.render.filepath=str(args.output_dir/f'skeleton-{role}-{view}.png'); bpy.ops.render.render(write_still=True)
print('SKELETON_BOW_EVIDENCE',args.output_dir)
