/**
 * @license
 * Copyright 2016 Google Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Signal} from 'signals';

import {RefCounted} from 'neuroglancer/util/disposable';
import {Vec3, Quat, Mat4, mat3, vec3, quat, mat4} from 'neuroglancer/util/geom';
import {parseFiniteVec} from 'neuroglancer/util/json';

export class VoxelSize extends RefCounted {
  size: Vec3;
  valid: boolean;
  changed = new Signal();
  constructor(voxelSize?: Vec3) {
    super();
    let valid = true;
    if (voxelSize == null) {
      voxelSize = vec3.create();
      valid = false;
    }
    this.size = voxelSize;
    this.valid = valid;
  }

  reset() {
    this.valid = false;
    this.changed.dispatch();
  }

  /**
   * This should be called after setting the voxel size initially.  The voxel
   * size should not be changed once it is valid.
   */
  setValid() {
    if (!this.valid) {
      this.valid = true;
      this.changed.dispatch();
    }
  }

  toJSON() {
    if (!this.valid) {
      return undefined;
    }
    return Array.prototype.slice.call(this.size);
  }

  restoreState(obj: any) {
    try {
      parseFiniteVec(this.size, obj);
      this.setValid();
    } catch (e) {
      this.valid = false;
    }
  }

  toString() {
    if (!this.valid) {
      return null;
    }
    return this.size.toString();
  }

  voxelFromSpatial(voxel: Vec3, spatial: Vec3) { vec3.divide(voxel, spatial, this.size); }

  spatialFromVoxel(spatial: Vec3, voxel: Vec3) { vec3.multiply(spatial, voxel, this.size); }
};

const tempVec3 = vec3.create();

export class SpatialPosition extends RefCounted {
  voxelSize: VoxelSize;
  spatialCoordinates: Vec3;
  spatialCoordinatesValid: boolean;
  private voxelCoordinates: Vec3 = null;
  changed = new Signal();
  constructor(voxelSize?: VoxelSize, spatialCoordinates?: Vec3) {
    super();
    if (voxelSize == null) {
      voxelSize = new VoxelSize();
    }
    this.voxelSize = voxelSize;

    let spatialCoordinatesValid = true;
    if (spatialCoordinates == null) {
      spatialCoordinates = vec3.create();
      spatialCoordinatesValid = false;
    }
    this.spatialCoordinates = spatialCoordinates;
    this.spatialCoordinatesValid = spatialCoordinatesValid;

    this.registerDisposer(voxelSize);
    this.registerSignalBinding(voxelSize.changed.add(this.handleVoxelSizeChanged, this));
  }

  get valid() { return this.spatialCoordinatesValid && this.voxelSize.valid; }

  get voxelCoordinatesValid() { return this.valid || this.voxelCoordinates != null; }

  reset() {
    this.spatialCoordinatesValid = false;
    this.voxelCoordinates = null;
    this.changed.dispatch();
  }

  getVoxelCoordinates(out: Vec3) {
    let {voxelCoordinates} = this;
    if (voxelCoordinates) {
      vec3.copy(out, voxelCoordinates);
    } else if (this.valid) {
      this.voxelSize.voxelFromSpatial(out, this.spatialCoordinates);
    } else {
      return false;
    }
    return true;
  }

  /**
   * Sets this position to the spatial coordinats corresponding to the specified
   * voxelPosition.  If this.voxelSize.valid == false, then this position won't
   * be set until it is.
   */
  setVoxelCoordinates(voxelCoordinates: Vec3) {
    let voxelSize = this.voxelSize;
    if (voxelSize.valid) {
      voxelSize.spatialFromVoxel(this.spatialCoordinates, voxelCoordinates);
      this.markSpatialCoordinatesChanged();
    } else {
      let voxelCoordinates_ = this.voxelCoordinates;
      if (!voxelCoordinates_) {
        this.voxelCoordinates = voxelCoordinates_ = vec3.clone(voxelCoordinates);
      } else {
        vec3.copy(voxelCoordinates_, voxelCoordinates);
      }
    }
    this.changed.dispatch();
  }

  markSpatialCoordinatesChanged() {
    this.spatialCoordinatesValid = true;
    this.voxelCoordinates = null;
    this.changed.dispatch();
  }

  private handleVoxelSizeChanged() {
    if (this.voxelCoordinates != null && !this.spatialCoordinatesValid) {
      this.voxelSize.spatialFromVoxel(this.spatialCoordinates, this.voxelCoordinates);
      this.spatialCoordinatesValid = true;
    }
    this.voxelCoordinates = null;
    this.changed.dispatch();
  }

  toJSON() {
    let empty = true;
    let voxelSizeJson = this.voxelSize.toJSON();
    let obj: any = {};
    if (voxelSizeJson !== undefined) {
      empty = false;
      obj['voxelSize'] = voxelSizeJson;
    }
    if (this.voxelCoordinatesValid) {
      let voxelCoordinates = tempVec3;
      this.getVoxelCoordinates(voxelCoordinates);
      obj['voxelCoordinates'] = Array.prototype.slice.call(voxelCoordinates);
      empty = false;
    } else if (this.spatialCoordinatesValid) {
      obj['spatialCoordinates'] = Array.prototype.slice.call(this.spatialCoordinates);
      empty = false;
    }
    if (empty) {
      return undefined;
    }
    return obj;
  }

  restoreState(obj: any) {
    this.voxelSize.restoreState(obj['voxelSize']);
    this.spatialCoordinatesValid = false;
    if (obj.hasOwnProperty('voxelCoordinates')) {
      try {
        let voxelCoordinates = vec3.create();
        parseFiniteVec(voxelCoordinates, obj['voxelCoordinates']);
        this.setVoxelCoordinates(voxelCoordinates);
      } catch (e) {
      }
    }
    try {
      parseFiniteVec(this.spatialCoordinates, obj['spatialCoordinates']);
      this.markSpatialCoordinatesChanged();
    } catch (e) {
    }
  }

  snapToVoxel() {
    if (!this.valid) {
      let {voxelCoordinates} = this;
      if (voxelCoordinates != null) {
        for (let i = 0; i < 3; ++i) {
          voxelCoordinates[i] = Math.round(voxelCoordinates[i]);
        }
        this.changed.dispatch();
      }
    } else {
      let spatialCoordinates = this.spatialCoordinates;
      let voxelSize = this.voxelSize.size;
      for (let i = 0; i < 3; ++i) {
        let voxelSizeValue = voxelSize[i];
        spatialCoordinates[i] = Math.round(spatialCoordinates[i] / voxelSizeValue) * voxelSizeValue;
      }
      this.changed.dispatch();
    }
  }
};

function quaternionIsIdentity(quat: Quat) {
  return quat[0] === 0 && quat[1] === 0 && quat[2] === 0 && quat[3] === 1;
}

class OrientationState extends RefCounted {
  orientation: Quat;
  changed = new Signal();
  constructor(orientation?: Quat) {
    super();
    if (orientation == null) {
      orientation = quat.create();
    }
    this.orientation = orientation;
  }
  toJSON() {
    let {orientation} = this;
    if (quaternionIsIdentity(orientation)) {
      return undefined;
    }
    return Array.prototype.slice.call(this.orientation);
  }
  restoreState(obj: any) {
    try {
      parseFiniteVec(this.orientation, obj);
      quat.normalize(this.orientation, this.orientation);
    } catch (ignoredError) {
      quat.identity(this.orientation);
    }
    this.changed.dispatch();
  }

  reset() {
    quat.identity(this.orientation);
    this.changed.dispatch();
  }

  snap() {
    let mat = mat3.create();
    mat3.fromQuat(mat, this.orientation);
    // console.log(mat);
    let usedAxes = [false, false, false];
    for (let i = 0; i < 3; ++i) {
      let maxComponent = 0;
      let argmaxComponent = 0;
      for (let j = 0; j < 3; ++j) {
        let value = mat[i * 3 + j];
        mat[i * 3 + j] = 0;
        if (usedAxes[j]) {
          continue;
        }
        if (Math.abs(value) > Math.abs(maxComponent)) {
          maxComponent = value;
          argmaxComponent = j;
        }
      }
      mat[i * 3 + argmaxComponent] = Math.sign(maxComponent);
      usedAxes[argmaxComponent] = true;
    }
    // console.log(mat);
    quat.fromMat3(this.orientation, mat);
    this.changed.dispatch();
  }
};

export class Pose extends RefCounted {
  position: SpatialPosition;
  orientation: OrientationState;
  changed = new Signal();
  constructor(position?: SpatialPosition, orientation?: OrientationState) {
    super();
    if (position == null) {
      position = new SpatialPosition();
    }
    this.position = position;
    if (orientation == null) {
      orientation = new OrientationState();
    }
    this.orientation = orientation;
    this.registerDisposer(this.position);
    this.registerDisposer(this.orientation);
    this.registerSignalBinding(this.position.changed.add(this.changed.dispatch, this.changed));
    this.registerSignalBinding(this.orientation.changed.add(this.changed.dispatch, this.changed));
  }

  get valid() { return this.position.valid; }

  /**
   * Resets everything except voxelSize.
   */
  reset() {
    this.position.reset();
    this.orientation.reset();
  }

  dispose() { this.position.changed.remove(this.changed.dispatch, this.changed); }

  toMat4(mat: Mat4) {
    mat4.fromRotationTranslation(
        mat, this.orientation.orientation, this.position.spatialCoordinates);
  }

  toJSON() {
    let positionJson = this.position.toJSON();
    let orientationJson = this.orientation.toJSON();
    if (positionJson === undefined && orientationJson === undefined) {
      return undefined;
    }
    return {'position': positionJson, 'orientation': orientationJson};
  }

  restoreState(obj: any) {
    this.position.restoreState(obj['position']);
    this.orientation.restoreState(obj['orientation']);
  }

  /**
   * Snaps the orientation to the nearest axis-aligned orientation, and
   * snaps the position to the nearest voxel.
   */
  snap() {
    this.orientation.snap();
    this.position.snapToVoxel();
    this.changed.dispatch();
  }
  translateAbsolute(translation: Vec3) {
    vec3.add(this.position.spatialCoordinates, this.position.spatialCoordinates, translation);
    this.position.changed.dispatch();
  }
  translateRelative(translation: Vec3) {
    if (!this.valid) {
      return;
    }
    var temp = vec3.create();
    vec3.transformQuat(temp, translation, this.orientation.orientation);
    vec3.add(this.position.spatialCoordinates, this.position.spatialCoordinates, temp);
    this.position.changed.dispatch();
  }
  rotateRelative(axis: Vec3, angle: number) {
    var temp = quat.create();
    quat.setAxisAngle(temp, axis, angle);
    var orientation = this.orientation.orientation;
    quat.multiply(orientation, orientation, temp);
    this.orientation.changed.dispatch();
  }

  rotateAbsolute(axis: Vec3, angle: number) {
    var temp = quat.create();
    quat.setAxisAngle(temp, axis, angle);
    var orientation = this.orientation.orientation;
    quat.multiply(orientation, temp, orientation);
    this.orientation.changed.dispatch();
  }
};

export class NavigationState extends RefCounted {
  pose: Pose;
  zoomFactor: number;
  changed = new Signal();
  constructor(pose?: Pose, zoomFactor?: number) {
    super();
    if (pose === undefined) {
      pose = new Pose();
    }
    this.pose = pose;

    if (zoomFactor === undefined) {
      zoomFactor = Number.NaN;
    }
    this.zoomFactor = zoomFactor;
    this.registerDisposer(pose);
    this.registerSignalBinding(this.pose.changed.add(this.changed.dispatch, this.changed));
    this.registerSignalBinding(this.voxelSize.changed.add(this.handleVoxelSizeChanged, this));
    this.setZoomFactorFromVoxelSize();
  }
  get voxelSize() { return this.pose.position.voxelSize; }

  /**
   * Resets everything except voxelSize.
   */
  reset() {
    this.pose.reset();
    this.resetZoom();
  }

  resetZoom() {
    this.zoomFactor = Number.NaN;
    this.changed.dispatch();
  }

  private setZoomFactorFromVoxelSize() {
    let {voxelSize} = this;
    if (voxelSize.valid) {
      this.zoomFactor = Math.min.apply(null, this.voxelSize.size);
      this.changed.dispatch();
    }
  }

  private handleVoxelSizeChanged() {
    if (Number.isNaN(this.zoomFactor)) {
      this.setZoomFactorFromVoxelSize();
    }
  }
  get position() { return this.pose.position; }
  toMat4(mat: Mat4) {
    this.pose.toMat4(mat);
    mat4.scale(mat, mat, vec3.fromValues(this.zoomFactor, this.zoomFactor, this.zoomFactor));
  };
  zoomBy(factor: number) {
    if (Number.isNaN(this.zoomFactor)) {
      return;
    }
    this.zoomFactor *= factor;
    this.changed.dispatch();
  }

  get valid() { return this.pose.valid; }

  toJSON() {
    let {zoomFactor} = this;
    let poseJson = this.pose.toJSON();
    let zoomFactorJson = zoomFactor == null || Number.isNaN(zoomFactor) ? undefined : zoomFactor;
    if (poseJson === undefined && zoomFactorJson === undefined) {
      return undefined;
    }
    return {'pose': poseJson, 'zoomFactor': zoomFactorJson};
  }

  restoreState(obj: any) {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    this.pose.restoreState(obj['pose']);
    let zoomFactor = parseFloat(obj['zoomFactor']);
    if (Number.isFinite(zoomFactor)) {
      this.zoomFactor = zoomFactor;
    } else {
      this.zoomFactor = Number.NaN;
    }
    this.handleVoxelSizeChanged();
    this.changed.dispatch();
  }
};

export class TrackableZoomState {
  constructor(public navigationState: NavigationState) {}
  get changed() { return this.navigationState.changed; }
  restoreState(obj: any) {
    if (typeof obj !== 'number') {
      return;
    }
    let zoomFactor = parseFloat('' + obj);
    if (Number.isFinite(zoomFactor)) {
      let {navigationState} = this;
      navigationState.zoomFactor = zoomFactor;
      navigationState.changed.dispatch();
    }
  }
  toJSON() {
    if (!this.navigationState.valid) {
      return undefined;
    }
    return this.navigationState.zoomFactor;
  }
};
