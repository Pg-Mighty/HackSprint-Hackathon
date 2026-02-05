package com.sumukh.websokets.controllers;

import com.sumukh.websokets.tupples.CursorPosition;
import com.sumukh.websokets.tupples.DrawingData;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;

public class controller  {

    @MessageMapping("/draw")
    @SendTo("/topic/draw")
    public DrawingData handleDrawingData(DrawingData drawingData) {
        return drawingData;
    }

    @MessageMapping("/cursor")
    @SendTo("/topic/cursor")
    public CursorPosition handleCursorPosition(CursorPosition pos){
        return pos;

    }

}
