package com.sumukh.socket.models;

public class DrawingData {

    private float x;
    private float y;

    DrawingData(){
        x = 0;
        y = 0;
    }


    public float getX(){
        return x;
    }
    public float getY(){
        return y;
    }
    public void set(float x, float y){
        this.x = x;
        this.y = y;
    }


}
